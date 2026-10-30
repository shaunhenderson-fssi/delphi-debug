program DelphiDebugAdapter;

{$APPTYPE CONSOLE}

uses
  Winapi.Windows,
  System.SysUtils;

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
  Buffer: array[0..MAX_PATH * 4] of Char;
  Len: DWORD;
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

  Len := GetFinalPathNameByHandle(
    DE.LoadDll.hFile,
    Buffer,
    Length(Buffer),
    FILE_NAME_NORMALIZED
  );

  if Len > 0 then
    Writeln(
      Format(
        'LOAD_DLL_DEBUG_EVENT Base=%p DLL=%s',
        [
          DE.LoadDll.lpBaseOfDll,
          string(Buffer)
        ]
      )
    )
  else
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

procedure DebugProcess(const ExeName: string; ShowDebugString: Boolean = False);
var
  SI:             TStartupInfoW;
  PI:             TProcessInformation;
  DE:             TDebugEvent;
  ContinueStatus: DWORD;
  CmdLine:        PWideChar;
begin
  Writeln('Exists = ', FileExists(ExeName));

  CmdLine := PWideChar(ExeName);

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
    RaiseLastOSError;
  end;

  Writeln('Debugger attached.');
  Writeln('Process ID: ', PI.dwProcessId);

  repeat
    if not WaitForDebugEvent(DE, INFINITE) then
      RaiseLastOSError;

    ContinueStatus := DBG_EXCEPTION_NOT_HANDLED; //DBG_CONTINUE

    case DE.dwDebugEventCode of

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

      EXCEPTION_DEBUG_EVENT:
        begin
          Writeln(
            Format(
              'EXCEPTION_DEBUG_EVENT Code=%x Address=%p',
              [
                DE.Exception.ExceptionRecord.ExceptionCode,
                DE.Exception.ExceptionRecord.ExceptionAddress
              ]
            )
          );
        end;

      EXIT_PROCESS_DEBUG_EVENT:
        begin
          Writeln(
            'EXIT_PROCESS_DEBUG_EVENT ExitCode=' +
            IntToStr(DE.ExitProcess.dwExitCode)
          );
        end;
    end;

    ContinueDebugEvent(
      DE.dwProcessId,
      DE.dwThreadId,
      ContinueStatus
    );

  until DE.dwDebugEventCode = EXIT_PROCESS_DEBUG_EVENT;

  CloseHandle(PI.hThread);
  CloseHandle(PI.hProcess);
end;

begin
  try
    DebugProcess(
      'C:\Apps\Inca\Bin\p1.exe',
      False //show debug output
    );

    Writeln('Finished.');
    Readln;
  except
    on E: Exception do
      Writeln(E.ClassName, ': ', E.Message);
  end;
end.
