param(
	[Parameter(Mandatory = $true)]
	[int]$ProcessId,
	[Parameter(Mandatory = $true)]
	[string]$VariableName
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ProcessEnvironmentReader {
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_BASIC_INFORMATION {
        public IntPtr Reserved1;
        public IntPtr PebBaseAddress;
        public IntPtr Reserved2_0;
        public IntPtr Reserved2_1;
        public IntPtr UniqueProcessId;
        public IntPtr Reserved3;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PEB {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 2)]
        public byte[] Reserved1;
        public byte BeingDebugged;
        public byte Reserved2;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 2)]
        public IntPtr[] Reserved3;
        public IntPtr Ldr;
        public IntPtr ProcessParameters;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RTL_USER_PROCESS_PARAMETERS {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)]
        public byte[] Reserved1;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 10)]
        public IntPtr[] Reserved2;
        public UNICODE_STRING ImagePathName;
        public UNICODE_STRING CommandLine;
        public IntPtr Environment;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, int processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadProcessMemory(IntPtr processHandle, IntPtr baseAddress, byte[] buffer, int size, out IntPtr bytesRead);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr processHandle, int processInformationClass, ref PROCESS_BASIC_INFORMATION processInformation, int processInformationLength, out int returnLength);

    private const uint PROCESS_QUERY_INFORMATION = 0x0400;
    private const uint PROCESS_VM_READ = 0x0010;

    private static T ReadStruct<T>(IntPtr processHandle, IntPtr address) where T : struct {
        int size = Marshal.SizeOf<T>();
        byte[] buffer = new byte[size];
        IntPtr bytesRead;
        if (!ReadProcessMemory(processHandle, address, buffer, size, out bytesRead) || bytesRead.ToInt64() < size) {
            throw new InvalidOperationException("ReadProcessMemory failed.");
        }
        GCHandle handle = GCHandle.Alloc(buffer, GCHandleType.Pinned);
        try {
            return Marshal.PtrToStructure<T>(handle.AddrOfPinnedObject());
        } finally {
            handle.Free();
        }
    }

    public static string GetEnvironmentVariable(int processId, string variableName) {
        IntPtr processHandle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, processId);
        if (processHandle == IntPtr.Zero) {
            throw new InvalidOperationException("OpenProcess failed.");
        }
        try {
            PROCESS_BASIC_INFORMATION processBasicInformation = new PROCESS_BASIC_INFORMATION();
            int returnLength;
            int status = NtQueryInformationProcess(processHandle, 0, ref processBasicInformation, Marshal.SizeOf<PROCESS_BASIC_INFORMATION>(), out returnLength);
            if (status != 0) {
                throw new InvalidOperationException("NtQueryInformationProcess failed.");
            }

            PEB peb = ReadStruct<PEB>(processHandle, processBasicInformation.PebBaseAddress);
            RTL_USER_PROCESS_PARAMETERS processParameters = ReadStruct<RTL_USER_PROCESS_PARAMETERS>(processHandle, peb.ProcessParameters);
            byte[] environmentBuffer = new byte[65536];
            IntPtr bytesRead;
            if (!ReadProcessMemory(processHandle, processParameters.Environment, environmentBuffer, environmentBuffer.Length, out bytesRead) || bytesRead.ToInt64() <= 0) {
                throw new InvalidOperationException("Unable to read environment block.");
            }

            string environmentBlock = Encoding.Unicode.GetString(environmentBuffer, 0, (int)bytesRead);
            string[] entries = environmentBlock.Split('\0');
            foreach (string entry in entries) {
                int separatorIndex = entry.IndexOf('=');
                if (separatorIndex <= 0) {
                    continue;
                }

                string name = entry.Substring(0, separatorIndex);
                if (!string.Equals(name, variableName, StringComparison.OrdinalIgnoreCase)) {
                    continue;
                }

                return entry.Substring(separatorIndex + 1);
            }

            return null;
        } finally {
            CloseHandle(processHandle);
        }
    }
}
"@

$value = [ProcessEnvironmentReader]::GetEnvironmentVariable($ProcessId, $VariableName)
if ($value) {
	[Console]::Write($value)
}