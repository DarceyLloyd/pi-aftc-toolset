# Usage Report

I've changed to this format as its a nightmare editing a huge single consoldated file of html, css and js, it's worse than HTML email building.

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