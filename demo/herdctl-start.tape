# VHS tape file for herdctl start demo
# Renders a terminal recording of fleet startup
#
# Usage: cd /path/to/herdctl && vhs demo/herdctl-start.tape

Output demo/herdctl-start.gif

Set FontSize 16
Set FontFamily "JetBrainsMono Nerd Font"
Set Width 1200
Set Height 850
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set BorderRadius 8
Set Padding 20
Set TypingSpeed 80ms
Set Framerate 30
Set CursorBlink false

# Set up alias behind the scenes
Hide
Type `alias npx="bash demo/herdctl-start.sh #"`
Enter
Sleep 300ms
Type "clear"
Enter
Sleep 200ms
Show

Type "npx herdctl start"
Sleep 500ms
Enter

Sleep 12s
