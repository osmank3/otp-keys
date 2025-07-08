# OTP keys for GNOME Shell
Show and copy otp keys

## Features
* Show otp codes on panel menu
* Copy codes to clipboards
* Supports SHA1, SHA256, SHA512 algoritms
* 30 and 60 seconds epoc time
* 6 - 8 digits options
* Import and export with otpauth://... and import with otpauth-migration://... links

## Installation
Normal users are recommended to get the extension from [extensions.gnome.org](https://extensions.gnome.org/extension/5697/otp-keys/).

Alternatively, you can check out a version from git, compile the language files, and symlink
`~/.local/share/gnome-shell/extensions/otp-keys@osmank3.net` to your clone:

```bash
git clone https://github.com/osmank3/otp-keys
```

If you are using Gnome version older than 45, set branch to `gnome-42-44`, then clone:

```bash
git clone https://github.com/osmank3/otp-keys -b gnome-42-44
```

Build and install:

```bash
npm install
npm run install:user
```

Under X11, you may need to restart GNOME Shell (<kbd>Alt</kbd>+<kbd>F2</kbd>, <kbd>r</kbd>, <kbd>⏎</kbd>)
after that. Under Wayland you need to logout and login again.
