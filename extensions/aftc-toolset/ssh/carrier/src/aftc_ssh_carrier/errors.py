"""Custom exception types used throughout the carrier.

RpcError is caught by the daemon and converted to a JSON-RPC error response.
SystemExit is re-raised (used for clean shutdown).
"""

from __future__ import annotations


class RpcError(Exception):
    """A JSON-RPC error.

    `code` follows the JSON-RPC spec for standard errors (-32700 to -32603)
    plus our custom range (-32000 to -32099 for carrier-specific errors).
    """

    def __init__(self, code: int, message: str, data: object = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def __str__(self) -> str:
        return self.message


# Standard JSON-RPC error codes
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

# Carrier-specific error codes (-32000 to -32099)
CONNECTION_FAILED = -32002
AUTH_FAILED = -32003
UNKNOWN_SESSION = -32004
UNKNOWN_SHELL = -32005
UNKNOWN_FORWARD = -32006
COMMAND_TIMEOUT = -32010
CHANNEL_CLOSED = -32011
FILE_NOT_FOUND = -32020
PERMISSION_DENIED = -32021
PATH_IS_DIRECTORY = -32022
PORT_IN_USE = -32030
KEY_LOAD_FAILED = -32040
HOST_KEY_UNKNOWN = -32041
HOST_KEY_CHANGED = -32042
NO_CARRIER = -32050
TRANSFER_CANCELLED = -32060