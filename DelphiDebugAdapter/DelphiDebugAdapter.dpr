program DelphiDebugAdapter;

{$APPTYPE CONSOLE}

uses
  Winapi.Windows,
  Winapi.TlHelp32,
  System.SysUtils,
  System.Generics.Collections;

type
  TLoadedModule = record
    BaseAddress: NativeUInt;
    FileName: string;
  end;

var
  LoadedModules: TList<TLoadedModule>;

const
  PROCESS_QUERY_LIMITED_INFORMATION = $1000;

function QueryFullProcessImageNameW(
  Process:   THandle;
  Flags:     DWORD;
  ImageName: PWideChar;
  var Size:  DWORD
): BOOL; stdcall; external kernel32 name 'QueryFullProcessImageNameW';

function SameExePath(const ExeName, ProcessPath: string): Boolean;
begin
  Result := SameText(ExpandFileName(ExeName), ExpandFileName(ProcessPath));
end;

function RunningProcessId(const ExeName: string): DWORD;
var
  Snapshot: THandle;
  Entry: TProcessEntry32W;
  Process: THandle;
  ImageName: array[0..MAX_PATH] of Char;
  ImageNameSize: DWORD;
begin
  Result := 0;
  Snapshot := CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if Snapshot = INVALID_HANDLE_VALUE then
    Exit;

  try
    Entry.dwSize := SizeOf(Entry);
    if Process32First(Snapshot, Entry) then
    repeat
      Process := OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, Entry.th32ProcessID);
      if Process <> 0 then
      begin
        try
          ImageNameSize := Length(ImageName);
          if QueryFullProcessImageNameW(Process, 0, @ImageName[0], ImageNameSize) and
             SameExePath(ExeName, Copy(string(ImageName), 1, ImageNameSize)) then
          begin
            Result := Entry.th32ProcessID;
            Exit;
          end;
        finally
          CloseHandle(Process);
        end;
      end;
    until not Process32Next(Snapshot, Entry);
  finally
    CloseHandle(Snapshot);
  end;
end;

function TargetMutexName(const ExeName: string): string;
begin
  Result := StringReplace(ExpandFileName(ExeName), '\', '_', [rfReplaceAll]);
  Result := StringReplace(Result, ':', '_', [rfReplaceAll]);
  Result := 'Global\DelphiDebugAdapter.Target.' + Result;
end;

procedure DumpDebugString(const DE: TDebugEvent; hProcess: THandle);
var
  Info: TOutputDebugStringInfo;
  BytesRead: NativeUInt;
  AnsiBuffer: array[0..1023] of AnsiChar;
  WideBuffer: array[0..1023] of WideChar;
begin
  Info := DE.DebugString;

  if Info.fUnicode <> 0 then
  begin
    FillChar(WideBuffer, SizeOf(WideBuffer), 0);

    if ReadProcessMemory(
         hProcess,
         Info.lpDebugStringData,
         @WideBuffer,
         SizeOf(WideBuffer) - SizeOf(WideChar),
         BytesRead) then
    begin
      Writeln('Debug(Unicode): ', WideBuffer);
      Writeln(
        Format(
          'OUTPUT_DEBUG_STRING_EVENT Unicode=%d Len=%d',
          [
            Info.fUnicode,
            Info.nDebugStringLength
          ]
        )
      );
    end;
  end
  else
  begin
    FillChar(AnsiBuffer, SizeOf(AnsiBuffer), 0);

    if ReadProcessMemory(
         hProcess,
         Info.lpDebugStringData,
         @AnsiBuffer,
         SizeOf(AnsiBuffer) - SizeOf(AnsiChar),
         BytesRead) then
    begin
      Writeln('Debug(ANSI): ', string(AnsiString(AnsiBuffer)));
      Writeln(
        Format(
          'OUTPUT_DEBUG_STRING_EVENT Unicode=%d Len=%d',
          [
            Info.fUnicode,
            Info.nDebugStringLength
          ]
        )
      );
    end;
  end;
end;

procedure DumpDllName(const DE: TDebugEvent);
var
  Buffer:  array[0..MAX_PATH * 4] of Char;
  Len:     DWORD;
  Module:  TLoadedModule;
  DllName: string;
begin
  if DE.LoadDll.hFile = 0 then
  begin
    Writeln(
      Format(
        'LOAD_DLL_DEBUG_EVENT Base=%p (no file handle)',
        [DE.LoadDll.lpBaseOfDll]
      )
    );
    Exit;
  end;

  Len := 0;
{$WARN SYMBOL_PLATFORM OFF}
  Len := GetFinalPathNameByHandle(
    DE.LoadDll.hFile,
    Buffer,
    Length(Buffer),
    FILE_NAME_NORMALIZED
  );
{$WARN SYMBOL_PLATFORM ON}

  if Len > 0 then
  begin
    Writeln(
      Format(
        'LOAD_DLL_DEBUG_EVENT Base=%p DLL=%s',
        [
          DE.LoadDll.lpBaseOfDll,
          string(Buffer)
        ]
      )
    );

    //TLoadedModule
    Module.BaseAddress := NativeUInt(DE.LoadDll.lpBaseOfDll);
    DllName := string(Buffer);
    Module.FileName := DllName;
    LoadedModules.Add(Module);
  end
  else
  begin
    Writeln(
      Format(
        'LOAD_DLL_DEBUG_EVENT Base=%p GetLastError=%d',
        [
          DE.LoadDll.lpBaseOfDll,
          GetLastError
        ]
      )
    );
  end;
end;

function InstallBreakpoint(Process: THandle; Address: Pointer; out OriginalByte: Byte): Boolean;
var
  Written: NativeUInt;
  CC: Byte;
begin
  Result := False;

  if not ReadProcessMemory(
    Process,
    Address,
    @OriginalByte,
    1,
    Written
  ) then
    Exit;

  CC := $CC;

  if not WriteProcessMemory(
    Process,
    Address,
    @CC,
    1,
    Written
  ) then
    Exit;

  FlushInstructionCache(Process, Address, 1);

  Result := True;
end;

procedure DebugProcess(const ExeName: string; ShowDebugString: Boolean = False);
var
  SI:             TStartupInfoW;
  PI:             TProcessInformation;
  DE:             TDebugEvent;
  ContinueStatus: DWORD;
  OriginalByte:   Byte;
  ProcessId:      DWORD;
  ProcessHandle:  THandle;
  TargetMutex:    THandle;
  Attached:       Boolean;
begin
  TargetMutex := 0;

  if not FileExists(ExeName) then
  begin
    Writeln(ExeName + ' does not exist, exiting.');
    Halt(1);
  end;

  ProcessId := RunningProcessId(ExeName);
  Attached := ProcessId <> 0;

  if Attached then
  begin
    ProcessHandle := OpenProcess(
      PROCESS_VM_OPERATION or PROCESS_VM_READ or PROCESS_VM_WRITE,
      False,
      ProcessId
    );

    if ProcessHandle = 0 then
      RaiseLastOSError;

    if not DebugActiveProcess(ProcessId) then
    begin
      CloseHandle(ProcessHandle);
      RaiseLastOSError;
    end;

    Writeln('Debugger attached to already running process.');
  end
  else
  begin
    TargetMutex := CreateMutex(nil, False, PChar(TargetMutexName(ExeName)));

    if TargetMutex = 0 then
      RaiseLastOSError;

    if GetLastError = ERROR_ALREADY_EXISTS then
    begin
      CloseHandle(TargetMutex);
      Writeln('Another debugger is already starting or attaching to this executable.');
      Exit;
    end;

    ZeroMemory(@PI, SizeOf(PI));

    ZeroMemory(@SI, SizeOf(SI));
    SI.cb := SizeOf(TStartupInfoW);

    if not CreateProcess(
      PChar(ExeName), // ApplicationName
      nil,            // CommandLine
      nil,
      nil,
      False,
      DEBUG_ONLY_THIS_PROCESS,
      nil,
      nil,
      SI,
      PI) then
    begin
      CloseHandle(TargetMutex);
      RaiseLastOSError;
    end;

    ProcessHandle := PI.hProcess;
    Writeln('Debugger attached to new process.');
  end;

  Writeln('Process ID: ', ProcessId);

  repeat
    if not WaitForDebugEvent(DE, INFINITE) then
      RaiseLastOSError;

    ContinueStatus := DBG_EXCEPTION_NOT_HANDLED;

    case DE.dwDebugEventCode of

      EXCEPTION_DEBUG_EVENT: //this needs to come first as it modifies the value of ContinueStatus
        begin
          case DE.Exception.ExceptionRecord.ExceptionCode of

            EXCEPTION_BREAKPOINT:
              begin
                Writeln(
                  Format(
                    'EXCEPTION_DEBUG_EVENT (BREAKPOINT) Code=%x Address=%p',
                    [
                      DE.Exception.ExceptionRecord.ExceptionCode,
                      DE.Exception.ExceptionRecord.ExceptionAddress
                    ]
                  )
                );
                ContinueStatus := DBG_CONTINUE;
              end;

            EXCEPTION_SINGLE_STEP:
              begin
                Writeln(
                  Format(
                    'EXCEPTION_DEBUG_EVENT (SINGLE_STEP) Code=%x Address=%p',
                    [
                      DE.Exception.ExceptionRecord.ExceptionCode,
                      DE.Exception.ExceptionRecord.ExceptionAddress
                    ]
                  )
                );
                ContinueStatus := DBG_CONTINUE;
              end;

          else
              begin
                ContinueStatus := DBG_EXCEPTION_NOT_HANDLED;
                Writeln(
                  Format(
                    'EXCEPTION_DEBUG_EVENT (UNHANDLED) Code=%x Address=%p',
                    [
                      DE.Exception.ExceptionRecord.ExceptionCode,
                      DE.Exception.ExceptionRecord.ExceptionAddress
                    ]
                  )
                );
              end;
          end;
        end;

      CREATE_PROCESS_DEBUG_EVENT:
        begin
          Writeln(
          Format(
            'CREATE_PROCESS_DEBUG_EVENT Code=%x Address=%p Base=%p',
            [
              DE.Exception.ExceptionRecord.ExceptionCode,
              DE.Exception.ExceptionRecord.ExceptionAddress,
              DE.CreateProcessInfo.lpBaseOfImage
            ]
          )
        );

        ContinueStatus := DBG_EXCEPTION_NOT_HANDLED;

        if InstallBreakpoint(
            ProcessHandle,
            Pointer($00FD72AC), //TODO: change this from a constant
            OriginalByte
          ) then
          Writeln('Breakpoint installed')
        else
          Writeln('Failed to install breakpoint');

        end;

      CREATE_THREAD_DEBUG_EVENT:
        begin
          Writeln('CREATE_THREAD_DEBUG_EVENT');
        end;

      EXIT_THREAD_DEBUG_EVENT:
        begin
          Writeln('EXIT_THREAD_DEBUG_EVENT');
        end;

      LOAD_DLL_DEBUG_EVENT:
        begin
          DumpDllName(DE);
        end;

      UNLOAD_DLL_DEBUG_EVENT:
        begin
          Writeln('UNLOAD_DLL_DEBUG_EVENT');
        end;

      OUTPUT_DEBUG_STRING_EVENT:
        begin
          {
          if ShowDebugString then
            DumpDebugString(DE, PI.hProcess)
          else
            Writeln('OUTPUT_DEBUG_STRING_EVENT (string hidden, enable string dumping to view)');
          }
        end;

      RIP_EVENT:
        begin
          Writeln('RIP_EVENT');
        end;

      EXIT_PROCESS_DEBUG_EVENT:
        begin
          Writeln('EXIT_PROCESS_DEBUG_EVENT ExitCode=' + IntToStr(DE.ExitProcess.dwExitCode));
        end;
    end;

    ContinueDebugEvent(
      DE.dwProcessId,
      DE.dwThreadId,
      ContinueStatus
    );

  until DE.dwDebugEventCode = EXIT_PROCESS_DEBUG_EVENT;

  CloseHandle(ProcessHandle);
  if not Attached then
  begin
    CloseHandle(PI.hThread);
    CloseHandle(TargetMutex);
  end;
end;

begin
  try
    DebugProcess(
      'C:\Apps\Inca\Bin\p1.exe',
{$IFDEF DEBUG}
      True //show debug output
{$ELSE}
      False //show debug output
{$ENDIF}
    );

    Writeln('Finished.');
    Readln;
  except
    on E: Exception do
      Writeln(E.ClassName, ': ', E.Message);
  end;
end.
