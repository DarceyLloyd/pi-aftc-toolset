# Usage Report

Seven tabs: **Overview · Models · Thinking levels · Timings · Projections ·
Context & allowance · Errors** — a dark-themed, responsive report of your
AI usage. Models can be sorted on every column and carry info icons with
mouse-over explanations; verdict badges call out the best and worst models
per metric. Money is formatted by `fmtMoney` everywhere.

## Usage
So, you're using pi, which means you should have node installed?, if not install it..

Then just run

```
node server.js
```

and your browser should open with the usage report.

Or you can use the start.bat, start.sh files.
NOTE: Linux and OSX users may need to chmod the start.sh file for exec permissions (I'm on windows).

Exiting the terminal will or start command etc will shut the server down, I've also programmed in a timeout, so if the usage report doesn't get used for 30 minutes it will terminate itself. Don't want any pesky unused random process's running the backgorund that are not needed.