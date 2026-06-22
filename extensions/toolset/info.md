Standard 16-color reference (foreground)
Code	Color
\x1b[30m	Black
\x1b[31m	Red
\x1b[32m	Green
\x1b[33m	Yellow
\x1b[34m	Blue
\x1b[35m	Magenta
\x1b[36m	Cyan
\x1b[37m	White
\x1b[90m	Bright Black (dark gray)
\x1b[91m	Bright Red
\x1b[92m	Bright Green
\x1b[93m	Bright Yellow
\x1b[94m	Bright Blue (light blue)
\x1b[95m	Bright Magenta
\x1b[96m	Bright Cyan
\x1b[97m	Bright White



Background colors
Prefix 3 → foreground, 4 → background. So \x1b[43m is yellow background, \x1b[44m is blue background, \x1b[104m is bright blue background, etc.

Common styles
Code	Effect
\x1b[0m	Reset all
\x1b[1m	Bold / Bright
\x1b[3m	Italic
\x1b[4m	Underline
\x1b[7m	Inverse / Reverse
You can chain them: \x1b[1;33m = bold + yellow. Always end with \x1b[0m to reset