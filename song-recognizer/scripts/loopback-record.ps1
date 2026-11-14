# 听歌识曲：WASAPI loopback（系统回放）录音脚本。
#
# 通过 WASAPI 的 loopback 模式录制“电脑正在播放的声音”，不经过麦克风。
# 录制在后台进程中运行，由 DSH 插件通过 -StopFlag 文件结束录音。
#
# 用法：
#   pwsh -NoProfile -File scripts\loopback-record.ps1 `
#     -OutputPath <wav> [-StopFlag <flag>] [-ReadyFlag <flag>] [-MaxSeconds 90]
#
# 参数：
#   -OutputPath  输出 WAV 文件（IEEE float 32bit，采样率取系统混音格式）。
#   -StopFlag    出现该文件时停止录音；省略时依赖 -MaxSeconds。
#   -ReadyFlag   开始采集后写入该文件，供插件判断“已开始录音”。
#   -MaxSeconds  最长录音秒数（0 表示不限制）。

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$StopFlag = '',
  [string]$ReadyFlag = '',
  [double]$MaxSeconds = 90
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace DshSongId
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject { }

    internal enum EDataFlow { Render, Capture, All }
    internal enum ERole { Console, Multimedia, Communications }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    internal struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
        int GetDevice(string id, out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr client);
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        int OpenPropertyStore(int access, out IntPtr properties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out int state);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioClient
    {
        int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        int GetBufferSize(out uint frames);
        int GetStreamLatency(out long latency);
        int GetCurrentPadding(out uint padding);
        int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
        int GetMixFormat(out IntPtr format);
        int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        int Start();
        int Stop();
        int Reset();
        int SetEventHandle(IntPtr handle);
        int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioCaptureClient
    {
        int GetBuffer(out IntPtr data, out uint frames, out uint flags, out long devicePosition, out long qpcPosition);
        int ReleaseBuffer(uint frames);
        int GetNextPacketSize(out uint frames);
    }

    /// <summary>System-audio (WASAPI loopback) recorder writing a float PCM WAV file.</summary>
    public static class Loopback
    {
        private const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
        private const int AUDCLNT_SHAREMODE_SHARED = 0;
        private const int CLSCTX_ALL = 23;
        private const int AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
        private static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");
        private static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317");
        private static readonly Guid SUBTYPE_IEEE_FLOAT = new Guid("00000003-0000-0010-8000-00aa00389b71");

        private static string lastError = string.Empty;
        public static string LastError { get { return lastError; } }

        /// <summary>Record the default playback endpoint until a stop-flag file appears or the limit elapses.</summary>
        public static int RecordUntil(string outputPath, string stopFlagPath, string readyFlagPath, double maxSeconds)
        {
            IAudioClient client = null;
            IAudioCaptureClient capture = null;
            FileStream stream = null;
            BinaryWriter writer = null;
            try
            {
                var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                IMMDevice device;
                int hr = enumerator.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Console, out device);
                if (hr != 0) { lastError = "GetDefaultAudioEndpoint 失败，HRESULT=0x" + hr.ToString("X8"); return hr; }

                object iface;
                Guid iid = IID_IAudioClient;
                hr = device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out iface);
                if (hr != 0) { lastError = "Activate(IAudioClient) 失败，HRESULT=0x" + hr.ToString("X8"); return hr; }
                client = (IAudioClient)iface;

                IntPtr formatPtr;
                hr = client.GetMixFormat(out formatPtr);
                if (hr != 0) { lastError = "GetMixFormat 失败，HRESULT=0x" + hr.ToString("X8"); return hr; }
                WAVEFORMATEX format = (WAVEFORMATEX)Marshal.PtrToStructure(formatPtr, typeof(WAVEFORMATEX));
                bool isFloat = format.wFormatTag == 3;
                if (format.wFormatTag == 0xFFFE && format.cbSize >= 22)
                {
                    Guid subFormat = (Guid)Marshal.PtrToStructure(new IntPtr(formatPtr.ToInt64() + 24), typeof(Guid));
                    isFloat = subFormat == SUBTYPE_IEEE_FLOAT;
                }

                hr = client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 0, 0, formatPtr, IntPtr.Zero);
                if (hr != 0) { lastError = "Initialize(loopback) 失败，HRESULT=0x" + hr.ToString("X8"); return hr; }

                Guid captureIid = IID_IAudioCaptureClient;
                object captureObj;
                hr = client.GetService(ref captureIid, out captureObj);
                if (hr != 0) { lastError = "GetService(IAudioCaptureClient) 失败，HRESULT=0x" + hr.ToString("X8"); return hr; }
                capture = (IAudioCaptureClient)captureObj;

                stream = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.Read);
                writer = new BinaryWriter(stream);
                WriteWaveHeader(writer, format, isFloat);
                long dataBytes = 0;

                hr = client.Start();
                if (hr != 0) { lastError = "Start 失败，HRESULT=0x" + hr.ToString("X8"); return hr; }

                if (!string.IsNullOrEmpty(readyFlagPath))
                {
                    try { File.WriteAllText(readyFlagPath, DateTime.UtcNow.ToString("o")); } catch { }
                }

                DateTime started = DateTime.UtcNow;
                bool stop = false;
                while (!stop)
                {
                    if (maxSeconds > 0 && (DateTime.UtcNow - started).TotalSeconds >= maxSeconds) stop = true;
                    if (!stop && !string.IsNullOrEmpty(stopFlagPath) && File.Exists(stopFlagPath)) stop = true;
                    if (stop) break;
                    Thread.Sleep(40);
                    uint packetFrames;
                    while (capture.GetNextPacketSize(out packetFrames) == 0 && packetFrames > 0)
                    {
                        IntPtr data;
                        uint frames;
                        uint flags;
                        long devicePosition;
                        long qpcPosition;
                        int bufferHr = capture.GetBuffer(out data, out frames, out flags, out devicePosition, out qpcPosition);
                        if (bufferHr != 0) break;
                        int bytes = (int)frames * format.nBlockAlign;
                        if (bytes > 0)
                        {
                            byte[] buffer = new byte[bytes];
                            if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) == 0 && data != IntPtr.Zero)
                            {
                                Marshal.Copy(data, buffer, 0, bytes);
                            }
                            writer.Write(buffer);
                            dataBytes += bytes;
                        }
                        capture.ReleaseBuffer(frames);
                    }
                }
                client.Stop();
                writer.Flush();
                if (stream.CanSeek)
                {
                    stream.Seek(4, SeekOrigin.Begin);
                    byte[] riff = BitConverter.GetBytes((uint)(dataBytes + 36));
                    stream.Write(riff, 0, 4);
                    stream.Seek(40, SeekOrigin.Begin);
                    byte[] dataSize = BitConverter.GetBytes((uint)dataBytes);
                    stream.Write(dataSize, 0, 4);
                    stream.Seek(0, SeekOrigin.End);
                }
                return 0;
            }
            catch (Exception ex)
            {
                lastError = ex.ToString();
                return -1;
            }
            finally
            {
                if (client != null) { try { client.Stop(); } catch { } }
                if (writer != null) { try { writer.Flush(); writer.Dispose(); } catch { } }
                if (stream != null) { try { stream.Dispose(); } catch { } }
            }
        }

        private static void WriteWaveHeader(BinaryWriter writer, WAVEFORMATEX format, bool isFloat)
        {
            ushort bits = format.wBitsPerSample;
            ushort channels = format.nChannels;
            uint rate = format.nSamplesPerSec;
            ushort blockAlign = (ushort)(channels * (bits / 8));
            writer.Write(Encoding.ASCII.GetBytes("RIFF"));
            writer.Write((uint)0);
            writer.Write(Encoding.ASCII.GetBytes("WAVE"));
            writer.Write(Encoding.ASCII.GetBytes("fmt "));
            writer.Write((uint)16);
            writer.Write((ushort)(isFloat ? 3 : 1));
            writer.Write(channels);
            writer.Write(rate);
            writer.Write((uint)(rate * blockAlign));
            writer.Write(blockAlign);
            writer.Write(bits);
            writer.Write(Encoding.ASCII.GetBytes("data"));
            writer.Write((uint)0);
        }
    }
}
'@ -Language CSharp

$outputFull = [IO.Path]::GetFullPath($OutputPath)
$outputDir = Split-Path -Parent $outputFull
if ($outputDir -and -not (Test-Path $outputDir)) { New-Item -ItemType Directory -Force $outputDir | Out-Null }

$stopFull = ''
$readyFull = ''
if ($StopFlag) {
  $stopFull = [IO.Path]::GetFullPath($StopFlag)
  if (Test-Path $stopFull) { Remove-Item -LiteralPath $stopFull -Force }
}
if ($ReadyFlag) {
  $readyFull = [IO.Path]::GetFullPath($ReadyFlag)
  if (Test-Path $readyFull) { Remove-Item -LiteralPath $readyFull -Force }
}

try {
  $code = [DshSongId.Loopback]::RecordUntil($outputFull, $stopFull, $readyFull, $MaxSeconds)
} catch {
  [Console]::Error.WriteLine("录音异常：$($_.Exception.Message)")
  exit 1
}

if ($code -ne 0) {
  [Console]::Error.WriteLine("录音失败：$([DshSongId.Loopback]::LastError)")
  exit 1
}

exit 0
