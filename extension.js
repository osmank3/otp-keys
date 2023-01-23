/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/* exported init */

const GETTEXT_DOMAIN = 'otp-keys';

const { GObject, St, Clutter, GLib } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const clipboard = St.Clipboard.get_default();

const _ = ExtensionUtils.gettext;

const ThisExtension = ExtensionUtils.getCurrentExtension();
const Totp = ThisExtension.imports.totp;

const SETTINGS_KEY = "secret-list";


class SecretMenuItem extends PopupMenu.PopupBaseMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(secret) {
        super();

        this._secret = secret;

        this.label = new St.Label({
            text: secret.username,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this.label);
        this.label_actor = this.label;

        let code = new St.Label({
            text: this.human_readable_code(Totp.getCode(secret.secretcode, secret.digits, secret.epoctime, secret.hashlib)),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add(code);

        let copyIcon = new St.Icon({
            icon_name: "edit-copy-symbolic",
            style_class: "popup-menu-icon",
        });
        let copyButton = new St.Button({
            child: copyIcon,
        });
        copyButton.connect('clicked', this._copyToClipboard.bind(this));
        this.add(copyButton);
    }

    _copyToClipboard() {
        let code = Totp.getCode(this._secret.secretcode, this._secret.digits, this._secret.epoctime, this._secret.hashlib);
        clipboard.set_text(St.ClipboardType.PRIMARY, code);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, code);

        Main.notify(_("Code copied to clipboard."));
    }

    human_readable_code(code) {
        let readableCode = String(code);
        if (readableCode.length === 6)
            readableCode = readableCode.slice(0,3) + " " + readableCode.slice(3);
        else if (readableCode.length === 7)
            readableCode = readableCode.slice(0,1) + " " + readableCode.slice(1, 4) + " " + readableCode.slice(4);
        else if (readableCode.length === 8)
            readableCode = readableCode.slice(0,2) + " " + readableCode.slice(2, 5) + " " + readableCode.slice(5);
        return readableCode;
    }
}


const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Gnome Shell OTP');

        this._settings = ExtensionUtils.getSettings("org.gnome.shell.extensions.otp-keys");

        this.add_child(new St.Icon({
            icon_name: 'dialog-password-symbolic',
            style_class: 'system-status-icon',
        }));

        this._changedId =
            this._settings.connect(`changed::${SETTINGS_KEY}`,
                () => this._sync());

        this._menuStatus = true;
        this._sync();

        this.menu.connect('open-state-changed', this._onOpenStateChanged.bind(this));
        this.menu.connect('destroy', this._onDestroy.bind(this));
    }

    _sync() {
        this._secrets = [];
        for (const stringSecret of this._settings.get_strv(SETTINGS_KEY)) {
            const [secretcode, username, epoctime, digits, hashlib] = stringSecret.split(":");
            const secret = {
                "secretcode": secretcode,
                "username": username,
                "epoctime": epoctime,
                "digits": digits,
                "hashlib": hashlib
            };
            this._secrets.push(secret);
        }

        this._fillMenu();
    }

    _fillMenu() {
        this.menu.removeAll();
        this._secrets.forEach(secret => {
            let item = new SecretMenuItem(secret);
            this.menu.addMenuItem(item);
        });

        let preferences = new PopupMenu.PopupMenuItem(_("Preferences"));
        preferences.connect('activate', () => {
            if (typeof ExtensionUtils.openPrefs === 'function') {
                ExtensionUtils.openPrefs();
            } else {
                Util.spawn([
                    "gnome-shell-extension-prefs",
                    ThisExtension.uuid
                ]);
            }
        });
        this.menu.addMenuItem(preferences);
    }

    _onOpenStateChanged(menu, open) {
        if (open) {
            this._menuStatus = true;
            this._fillMenu();
            let interval = 30000 - (parseInt(new Date().getTime()) % 30000);
            GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                interval,
                () => {
                    this._fillMenu();
                    GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT,
                        30000,
                        () => {
                            this._fillMenu();
                            return this._menuStatus;
                        }
                    );
                    return false;
                }
            );
        }
        else {
            this._menuStatus = false;
        }
    }

    _onDestroy() {
        this._menuStatus = false;
    }
});


class Extension {
    constructor(uuid) {
        this._uuid = uuid;
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this._uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}

function init(meta) {
    return new Extension(meta.uuid);
}

