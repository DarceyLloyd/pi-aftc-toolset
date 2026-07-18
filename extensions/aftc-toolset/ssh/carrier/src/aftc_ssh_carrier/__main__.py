"""Entry point for `python -m aftc_ssh_carrier`.

Equivalent to the `aftc-ssh-sidecar` console script defined in
pyproject.toml.
"""

import sys

from .daemon import main


if __name__ == "__main__":
    sys.exit(main() or 0)