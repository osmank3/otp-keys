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

const _ = ExtensionUtils.gettext;

const ThisExtension = ExtensionUtils.getCurrentExtension();
const Totp = ThisExtension.imports.totp;
const OtpLib = ThisExtension.imports.otplib;

const SETTINGS_OTP_LIST = "secret-list";
const SETTINGS_NOTIFY = "notifications";
const SETTINGS_COPY_ICONS = "copy-icons";


class OtpMenuItem extends PopupMenu.PopupBaseMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(otp, settings) {
        super();

        this._otp = otp;
        this._settings = settings;

        this.label = new St.Label({
            text: otp.username,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this.label);
        this.label_actor = this.label;

        let code = new St.Label({
            text: this.human_readable_code(Totp.getCode(otp.secret, otp.digits, otp.period, otp.algorithm)),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add(code);

        if (this._settings.get_boolean(SETTINGS_COPY_ICONS)) {
            let copyIcon = new St.Icon({
                icon_name: "edit-copy-symbolic",
                style_class: "popup-menu-icon",
            });
            this.add(copyIcon);
        }

        this.connect('activate', this._copyToClipboard.bind(this));
    }

    _copyToClipboard() {
        const clipboard = St.Clipboard.get_default();
        let code = Totp.getCode(this._otp.secret, this._otp.digits, this._otp.period, this._otp.algorithm);
        clipboard.set_text(St.ClipboardType.PRIMARY, code);
        clipboard.set_text(St.ClipboardType.CLIPBOARD, code);

        if (this._settings.get_boolean(SETTINGS_NOTIFY))
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
    _init(parent, settings) {
        super._init(0.5, 'Gnome Shell OTP');

        this._parent = parent;
        this._settings = settings;
        this._otpLib = new OtpLib.OtpLib();

        this.add_child(new St.Icon({
            icon_name: 'dialog-password-symbolic',
            style_class: 'system-status-icon',
        }));

        this._changedId =
            this._settings.connect(`changed::${SETTINGS_OTP_LIST}`,
                () => this._fillList());

        this._otpList = [];
        this._fillList();
    }

    _sync() {
        this._otpList = [];
        for (let stringSecret of this._settings.get_strv(SETTINGS_OTP_LIST)) {
            let otp = {}
            let username = "";
            if (stringSecret.split(":").length === 5) {
                //migrate to new one
                let [secret, username, period, digits, algorithm] = stringSecret.split(":");
                otp = {
                    "secret": secret,
                    "username": username,
                    "period": period,
                    "digits": digits,
                    "algorithm": algorithm,
                    "issuer": "otp-key"
                };
                this._otpLib.saveOtp(otp);
                stringSecret = `${username}:${otp.issuer}`;
            }

            let issuer = "otp-key";
            [username, issuer] = stringSecret.split(":");
            otp = this._otpLib.getOtp(username, issuer);
            if (typeof otp == "object")
                this._otpList.push(otp);
        }
    }

    _fillList() {
        this.menu.removeAll();
        if (this._otpLib.isKeyringUnlocked() === false) {
            let unlockkeyring = new PopupMenu.PopupMenuItem(_("Unlock Keyring"));
            unlockkeyring.connect('activate', () => {
                this._otpLib.unlockKeyring(this);
            });
            this.menu.addMenuItem(unlockkeyring);
        } else {
            this._sync();
            this._otpList.forEach(otp => {
                let item = new OtpMenuItem(otp, this._settings);
                this.menu.addMenuItem(item);
            });
        }

        let preferences = new PopupMenu.PopupMenuItem(_("Preferences"));
        preferences.connect('activate', () => {
            ExtensionUtils.openPrefs();
        });
        this.menu.addMenuItem(preferences);
    }

    _onOpenStateChanged(menu, open) {
        if (open) {
            if (this._delay == null) {
                this._fillList();
                let interval = 30000 - (parseInt(new Date().getTime()) % 30000);
                this._delay = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    interval,
                    () => {
                        this._fillList();
                        if (this._repeater == null) {
                            this._repeater = GLib.timeout_add(
                                GLib.PRIORITY_DEFAULT,
                                30000,
                                () => {
                                    this._fillList();
                                    return true;
                                }
                            );
                        }
                        this._delay = null;
                        return false;
                    }
                );
            }
        }
        else {
            if (this._delay) {
                GLib.Source.remove(this._delay);
                this._delay = null;
            }
            if (this._repeater) {
                GLib.Source.remove(this._repeater);
                this._repeater = null;
            }
        }
    }

    _onDestroy() {
        if (this._delay) {
            GLib.Source.remove(this._delay);
            this._delay = null;
        }
        if (this._repeater) {
            GLib.Source.remove(this._repeater);
            this._repeater = null;
        }
    }
});


class Extension {
    constructor(uuid) {
        this._uuid = uuid;
        ExtensionUtils.initTranslations(GETTEXT_DOMAIN);
    }

    enable() {
        this._indicator = new Indicator(ThisExtension, ExtensionUtils.getSettings("org.gnome.shell.extensions.otp-keys"));
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