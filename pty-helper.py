#!/usr/bin/env python3
import os
import pty
import select
import subprocess
import sys
import termios
import tty

def main():
    """
    PTY helper script for the Obsidian Terminal plugin.
    This script creates a pseudo-terminal and spawns a shell,
    forwarding input/output between the shell and stdout/stdin.
    """
    # Determine which shell to use
    shell = os.environ.get('SHELL', '/bin/zsh')

    # Create a pseudo-terminal
    master_fd, slave_fd = pty.openpty()

    # Spawn the shell process
    pid = os.fork()

    if pid == 0:
        # Child process
        os.close(master_fd)

        # Create a new session
        os.setsid()

        # Set controlling terminal
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)

        if slave_fd > 2:
            os.close(slave_fd)

        # Execute the shell
        os.execvp(shell, [shell])
    else:
        # Parent process
        os.close(slave_fd)

        # Set terminal to raw mode for stdin
        old_settings = None
        try:
            old_settings = termios.tcgetattr(sys.stdin)
            tty.setraw(sys.stdin.fileno())
        except:
            # If we can't set raw mode, continue anyway
            pass

        try:
            while True:
                # Use select to wait for input from either stdin or the pty
                readable, _, _ = select.select([sys.stdin, master_fd], [], [])

                for fd in readable:
                    if fd == sys.stdin:
                        # Read from stdin and write to pty
                        data = os.read(sys.stdin.fileno(), 1024)
                        if data:
                            os.write(master_fd, data)
                    elif fd == master_fd:
                        # Read from pty and write to stdout
                        try:
                            data = os.read(master_fd, 1024)
                            if data:
                                sys.stdout.buffer.write(data)
                                sys.stdout.buffer.flush()
                            else:
                                # EOF - shell exited
                                return
                        except OSError:
                            # PTY closed
                            return
        finally:
            # Restore terminal settings
            if old_settings:
                try:
                    termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
                except:
                    pass

if __name__ == '__main__':
    main()
