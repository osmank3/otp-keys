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

import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Totp from './totp.js';

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

        this.connect('activate', this._copyToClipboard.bind(this));
    }

    _copyToClipboard() {
        const clipboard = St.Clipboard.get_default();
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
    _init(parent, settings) {
        super._init(0.5, 'Gnome Shell OTP');

        this._parent = parent;
        this._settings = settings;

        this.add_child(new St.Icon({
            icon_name: 'dialog-password-symbolic',
            style_class: 'system-status-icon',
        }));

        this._changedId =
            this._settings.connect(`changed::${SETTINGS_KEY}`,
                () => this._sync());

        this._sync();
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
            this._parent.openPreferences();
        });
        this.menu.addMenuItem(preferences);
    }

    _onOpenStateChanged(menu, open) {
        if (open) {
            if (this._delay == null) {
                this._fillMenu();
                let interval = 30000 - (parseInt(new Date().getTime()) % 30000);
                this._delay = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    interval,
                    () => {
                        this._fillMenu();
                        if (this._repeater == null) {
                            this._repeater = GLib.timeout_add(
                                GLib.PRIORITY_DEFAULT,
                                30000,
                                () => {
                                    this._fillMenu();
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


export default class OtpKeys extends Extension {
    enable() {
        this._indicator = new Indicator(this, this.getSettings());
        Main.panel.addToStatusArea(this._uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
