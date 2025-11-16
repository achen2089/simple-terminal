#!/usr/bin/env python3
"""
PTY helper for Simple Terminal plugin
Based on obsidian-terminal's unix_pseudoterminal.py
"""
from os import (
    environ as _environ,
    execvp as _execvp,
    read as _read,
    waitpid as _waitpid,
    waitstatus_to_exitcode as _ws_to_ec,
    write as _write,
)
from selectors import DefaultSelector as _DefaultSelector, EVENT_READ as _EVENT_READ
from struct import pack as _pack
import sys as _sys
from sys import exit as _exit, stdin as _stdin, stdout as _stdout
from typing import Callable as _Callable, cast as _cast

if _sys.platform != "win32":
    from fcntl import ioctl as _ioctl
    import pty as _pty
    from termios import TIOCSWINSZ as _TIOCSWINSZ

    _FORK = _cast(
        _Callable[[], tuple[int, int]],
        _pty.fork,  # type: ignore
    )
    _CHUNK_SIZE = 1024
    _STDIN = _stdin.fileno()
    _STDOUT = _stdout.fileno()
    _CMDIO = 3  # File descriptor for resize commands

    def main():
        # Determine which shell to use
        shell = _environ.get('SHELL', '/bin/zsh')

        # Fork and create PTY
        pid, pty_fd = _FORK()

        if pid == 0:
            # Child process - execute the shell
            _execvp(shell, [shell])

        # Parent process - handle I/O
        def write_all(fd: int, data: bytes):
            """Write all data to file descriptor"""
            while data:
                data = data[_write(fd, data):]

        with _DefaultSelector() as selector:
            running = True

            def pipe_pty():
                """Read from PTY and write to stdout"""
                nonlocal running
                try:
                    data = _read(pty_fd, _CHUNK_SIZE)
                except OSError:
                    data = b""
                if not data:
                    selector.unregister(pty_fd)
                    running = False
                    return
                write_all(_STDOUT, data)

            def pipe_stdin():
                """Read from stdin and write to PTY"""
                data = _read(_STDIN, _CHUNK_SIZE)
                if not data:
                    selector.unregister(_STDIN)
                    return
                write_all(pty_fd, data)

            def process_cmdio():
                """Process resize commands from file descriptor 3"""
                data = _read(_CMDIO, _CHUNK_SIZE)
                if not data:
                    selector.unregister(_CMDIO)
                    return
                # Parse resize commands in format "ROWSxCOLUMNS"
                for line in data.decode("UTF-8", "strict").splitlines():
                    try:
                        rows, columns = (int(ss.strip()) for ss in line.split("x", 2))
                        # Set window size using ioctl
                        _ioctl(
                            pty_fd,
                            _TIOCSWINSZ,
                            _pack("HHHH", rows, columns, 0, 0),
                        )
                    except (ValueError, IndexError):
                        # Ignore malformed resize commands
                        pass

            # Register I/O handlers
            selector.register(pty_fd, _EVENT_READ, pipe_pty)
            selector.register(_STDIN, _EVENT_READ, pipe_stdin)
            selector.register(_CMDIO, _EVENT_READ, process_cmdio)

            # Event loop
            while running:
                for key, _ in selector.select():
                    key.data()

        # Wait for child process and exit with its code
        _exit(_ws_to_ec(_waitpid(pid, 0)[1]))

else:
    def main():
        raise NotImplementedError(_sys.platform)


if __name__ == "__main__":
    main()
