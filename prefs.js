// -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*-
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gst from 'gi://Gst';
import GstApp from 'gi://GstApp';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Totp from './totp.js';
import OtpLib from './otplib.js';

import "./vendor/jsqr.js";

const SETTINGS_OTP_LIST = "secret-list";
const SETTINGS_NOTIFY = "notifications";
const SETTINGS_COPY_ICONS = "copy-icons";

class OtpRoot {
    constructor(extension) {
        this.extension = extension;
        this.window = null;
        this.settings = extension.getSettings();
        this.lib = new OtpLib();
        this.list = new OtpList(this);
    }

    setWindow(window) {
        this.window = window;
    }

    showToast(text) {
        if (this.window) {
            let toast = new Adw.Toast({
                title: text,
            });
            this.window.add_toast(toast);
        }
    }

    copyToClipboards(text) {
        const clipboard = Gdk.Display.get_default().get_clipboard();
        const clipboardPrimary = Gdk.Display.get_default().get_primary_clipboard();

        clipboard.set(text);
        clipboardPrimary.set(text);
    }
}

class NewItem extends GObject.Object {}
GObject.registerClass(NewItem);


class NewItemModel extends GObject.Object {
    static [GObject.interfaces] = [Gio.ListModel];
    static {
        GObject.registerClass(this);
    }

    _item = new NewItem();

    vfunc_get_item_type() {
        return NewItem;
    }

    vfunc_get_n_items() {
        return 1;
    }

    vfunc_get_item(_pos) {
        return this._item;
    }
}


class Otp extends GObject.Object {
    static [GObject.properties] = {
        secret: GObject.ParamSpec.string(
            "secret", "secret", "secret",
            GObject.ParamFlags.READWRITE,
            null
        ),
        username: GObject.ParamSpec.string(
            "username", "username", "username",
            GObject.ParamFlags.READWRITE,
            null
        ),
        issuer: GObject.ParamSpec.string(
            "issuer", "issuer", "issuer",
            GObject.ParamFlags.READWRITE,
            "otp-key"
        ),
        period: GObject.ParamSpec.string(
            "period", "period", "period",
            GObject.ParamFlags.READWRITE,
            "30"
        ),
        digits: GObject.ParamSpec.string(
            "digits", "digits", "digits",
            GObject.ParamFlags.READWRITE,
            "6"
        ),
        algorithm: GObject.ParamSpec.string(
            "algorithm", "algorithm", "algorithm",
            GObject.ParamFlags.READWRITE,
            "sha1"
        )
    };

    static {
        GObject.registerClass(this);
    }

    constructor(otp) {
        super();
        this.secret = otp.secret;
        this.username = otp.username;
        this.issuer = otp.issuer;
        this.period = otp.period;
        this.digits = otp.digits;
        this.algorithm = otp.algorithm;
    }
}


class OtpList extends GObject.Object {
    static [GObject.interfaces] = [Gio.ListModel];
    static {
        GObject.registerClass(this);
    }

    constructor(otpRoot) {
        super();

        this.otpRoot = otpRoot;

        this.otpList = [];
        this.changedId =
            this.otpRoot.settings.connect(`changed::${SETTINGS_OTP_LIST}`,
                () => this._sync());
        this._sync();
    }

    append(otp) {
        const pos = this.otpList.length;

        this.otpList.push(new Otp({
            secret: otp.secret,
            username: otp.username,
            issuer: otp.issuer,
            period: otp.period,
            digits: otp.digits,
            algorithm: otp.algorithm
        }));
        this._saveOtpList();

        this.items_changed(pos, 0, 1);
    }

    remove(otpParams) {
        let pos = -1;
        let i = 0;
        this.otpList.forEach((otp) => {
            if (otp.username === otpParams[0] & otp.issuer === otpParams[1]) {
                pos = i;
                return;
            }
            i = i + 1;
        })

        if (pos < 0)
            return;

        this.otpRoot.lib.removeOtp(this.otpList[pos]);
        this.otpList.splice(pos, 1);
        this._saveOtpList();

        this.items_changed(pos, 1, 0);
    }

    move(oldPos, newPos) {
        if (oldPos === newPos)
            return;

        let [movedItem] = this.otpList.splice(oldPos, 1);
        this.otpList.splice(newPos, 0, movedItem);

        this._saveOtpList();

        this.items_changed(oldPos, 1, 0);
        this.items_changed(newPos, 0, 1);
    }

    export(otpParams) {
        this.otpList.forEach((otp) => {
            if (otp.username === otpParams[0] & otp.issuer === otpParams[1]) {
                let otpUrl = this.otpRoot.lib.makeURL(otp);
                this.otpRoot.copyToClipboards(otpUrl);
                this.otpRoot.showToast(_("Otp link exported to clipboard."));
                return;
            }
        });
    }

    copyToClipboard(otpParams) {
        this.otpList.forEach((otp) => {
            if (otp.username === otpParams[0] & otp.issuer === otpParams[1]) {
                let code = Totp.getCode(otp.secret, otp.digits, otp.period, otp.algorithm);
                this.otpRoot.copyToClipboards(code);
                this.otpRoot.showToast(_("Code copied to clipboard."));
                return;
            }
        });
    }

    _saveOtpList() {
        this.otpRoot.settings.block_signal_handler(this.changedId);
        this.otpRoot.settings.set_strv(
            SETTINGS_OTP_LIST,
            this.otpList.map(otp => this.otpRoot.lib.createId(otp.secret))
        );
        this.otpRoot.settings.unblock_signal_handler(this.changedId)
    }

    _sync() {
        const removed = this.otpList.length;

        this.otpList = [];
        let migrated = false;
        if (this.otpRoot.lib.isKeyringUnlocked()) {
            for (let stringSecret of this.otpRoot.settings.get_strv(SETTINGS_OTP_LIST)) {
                let otp = {};
                let username = "";
                if (stringSecret.split(":").length === 5) {
                    //migrate oldest to a new one
                    let [secret, username, period, digits, algorithm] = stringSecret.split(":");
                    otp = {
                        "secret": secret,
                        "username": username,
                        "period": period,
                        "digits": digits,
                        "algorithm": algorithm,
                        "issuer": "otp-key"
                    };
                    this.otpRoot.lib.saveOtp(otp);
                    stringSecret = this.otpRoot.lib.createId(otp.secret);
                    migrated = true;
                } else if (stringSecret.includes(":")) {
                    //migrate old to a new one
                    let issuer = "otp-key";
                    [username, issuer] = stringSecret.split(":");
                    otp = this.otpRoot.lib.getOldOtp(username, issuer);
                    this.otpRoot.lib.saveOtp(otp);
                    this.otpRoot.lib.removeOtp(otp, true);
                    stringSecret = this.otpRoot.lib.createId(otp.secret);
                    migrated = true;
                }

                otp = this.otpRoot.lib.getOtp(stringSecret);

                if (otp !== null)
                    this.otpList.push(new Otp(otp));
            }
        }
        if (migrated)
            this._saveOtpList();
        this.items_changed(0, removed, this.otpList.length);
    }

    vfunc_get_item_type() {
        return Otp;
    }

    vfunc_get_n_items() {
        return this.otpList.length;
    }

    vfunc_get_item(pos) {
        return this.otpList[pos] ?? null;
    }
}


class OtpKeysSettingsPageWidget extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(otpRoot) {
        super();
        let otpListWidget = new OtpKeysSecretListWidget(otpRoot);
        this.add(otpListWidget);

        let settingsWidget = new OtpKeysSettingsWidget(otpRoot);
        this.add(settingsWidget);
    }
}


class OtpKeysSecretListWidget extends Adw.PreferencesGroup {

    static {
        GObject.registerClass(this);

        this.install_action("otpList.export", "as", (self, name, param) => self.otpRoot.list.export(param.get_strv()));
        this.install_action("otpList.remove", "as", (self, name, param) => self.otpRoot.list.remove(param.get_strv()));
        this.install_action("otpList.copy", "as", (self, name, param) => self.otpRoot.list.copyToClipboard(param.get_strv()));
        this.install_action("otpList.unlock_keyring", null, self => self._unlockKeyring());
        this.install_action("otpList.refresh", null, self => self._fillList());
    }

    constructor(otpRoot) {
        super({
            title: _('Secrets'),
        });

        this.otpRoot = otpRoot;

        this._list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        this.add(this._list);

        let dropTarget = new Gtk.DropTarget({
            actions: Gdk.DragAction.MOVE,
        });
        dropTarget.set_gtypes([GObject.TYPE_INT]);

        dropTarget.connect('drop', (target, value, x, y) => {
            let sourcePos = value;
            let targetRow = this._list.get_row_at_y(y);

            if (!targetRow) return false;

            let targetPos = targetRow.get_index();

            let nOtpItems = this.otpRoot.list.get_n_items();
            if (targetPos >= nOtpItems) {
                return false;
            }

            this.otpRoot.list.move(sourcePos, targetPos);
            return true;
        });
        this._list.add_controller(dropTarget);

        this.set_header_suffix(new Gtk.Button({
            action_name: 'otpList.refresh',
            icon_name: 'view-refresh-symbolic',
            has_frame: false,
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Refresh")
        }));

        this._fillList();
    }

    _fillList() {
        const store = new Gio.ListStore({item_type: Gio.ListModel});
        const listModel = new Gtk.FlattenListModel({model: store});

        if (this.otpRoot.lib.isKeyringUnlocked()) {
            this.otpRoot.list._sync();
            store.append(this.otpRoot.list);
            store.append(new NewItemModel());// This line is for new otp
            store.append(new NewItemModel());// This line is for import otp
        }

        while (this._list.get_last_child() != null) {
            this._list.remove(this._list.get_last_child());
        }

        if (this.otpRoot.lib.isKeyringUnlocked()) {
            let newAdded = false;
            this._list.bind_model(listModel, item => {
                if (item instanceof Otp) {
                    return new OtpRowExpanded(this.otpRoot, item);
                } else if (newAdded === false) {
                    newAdded = true;
                    return new OtpRowExpanded(this.otpRoot, null);
                } else {
                    return new ImportOtpRowExpanded(this.otpRoot);
                }
            });
        } else {
            store.append(new NewItemModel());
            this._list.bind_model(listModel, item => {
                return new Adw.ActionRow({
                    activatable: true,
                    action_name: 'otpList.unlock_keyring',
                    title: _("Unlock Keyring")
                });
            });
        }
    }

    _unlockKeyring() {
        this.otpRoot.lib.unlockKeyring(this);
        this._fillList();
    }
}

class OtpKeysSettingsWidget extends Adw.PreferencesGroup{
    static {
        GObject.registerClass(this);
    }

    constructor(otpRoot) {
        super({
            title: _("Settings")
        });

        this.showNotificationSwitch = new Adw.SwitchRow({
            title: _("Show Notifications")
        })
        this.add(this.showNotificationSwitch);

        otpRoot.settings.bind(SETTINGS_NOTIFY, this.showNotificationSwitch, 'active', Gio.SettingsBindFlags.DEFAULT)

        this.showCopyIconsSwitch = new Adw.SwitchRow({
            title: _("Show Copy Icons")
        })
        this.add(this.showCopyIconsSwitch);

        otpRoot.settings.bind(SETTINGS_COPY_ICONS, this.showCopyIconsSwitch, 'active', Gio.SettingsBindFlags.DEFAULT)
    }
}

class CodeButton extends Gtk.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(otp) {
        super({
            action_name: 'otpList.copy',
            action_target: new GLib.Variant('as', [otp.username, otp.issuer]),
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Copy")
        })

        this.otp = otp;

        this.connect('unrealize', this._onUnrealize.bind(this));
        this.connect('destroy', this._onDestroy.bind(this));

        this.refreshCode();

        let interval = 30000 - (parseInt(new Date().getTime()) % 30000);
        if (this._delay == null) {
            this._delay = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                interval,
                () => {
                    this.refreshCode();
                    if (this._repeater == null) {
                        this._repeater = GLib.timeout_add(
                            GLib.PRIORITY_DEFAULT,
                            30000,
                            () => {
                                this.refreshCode();
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

    refreshCode() {
        this.set_label(this.human_readable_code(Totp.getCode(this.otp.secret, this.otp.digits, this.otp.period, this.otp.algorithm)))
    }

    _onUnrealize() {
        if (this._delay) {
            GLib.Source.remove(this._delay);
            this._delay = null;
        }
        if (this._repeater) {
            GLib.Source.remove(this._repeater);
            this._repeater = null;
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
}

class OtpRowExpanded extends Adw.ExpanderRow {
    static {
        GObject.registerClass(this);

        this.install_action("otpRow.edit", null, self => self._edit());
        this.install_action("otpRow.save", null, self => self._save());
        this.install_action("otpRow.new", null, self => self._new());
    }

    constructor(otpRoot, otp) {
        super({
            activatable: otp ? false : true,
            expanded: false,
            enable_expansion: false,
            action_name: otp ? null : "otpRow.new",
            show_enable_switch: false,
            title: otp ? otp.username : _("Add Secret"),
            subtitle: otp ? otp.issuer : null
        });

        this.otpRoot = otpRoot;
        this.otp = otp;

        if (this.otp) {
            let dragSource = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });

            this.add_controller(dragSource);

            dragSource.connect('prepare', (source, x, y) => {
                let value = this.get_index();
                return Gdk.ContentProvider.new_for_value(value);
            });
        }

        this._setButtons();
        this._setRows();
    }

    _setButtons() {
        if (this.otp) {
            this.editMode = true;
            this.code = new CodeButton(this.otp);

            this.edit = new Gtk.Button({
                action_name: 'otpRow.edit',
                icon_name: 'document-edit-symbolic',
                has_frame: false,
                valign: Gtk.Align.CENTER,
                tooltip_text: _("Edit")
            });

            this.exportBtn = new Gtk.Button({
                action_name: 'otpList.export',
                action_target: new GLib.Variant('as', [this.otp.username, this.otp.issuer]),
                icon_name: 'document-revert-symbolic-rtl',
                has_frame: false,
                valign: Gtk.Align.CENTER,
                tooltip_text: _("Export")
            });

            this.remove = new Gtk.Button({
                action_name: 'otpList.remove',
                action_target: new GLib.Variant('as', [this.otp.username, this.otp.issuer]),
                icon_name: 'edit-delete-symbolic',
                has_frame: false,
                valign: Gtk.Align.CENTER,
                tooltip_text: _("Remove")
            });

            this.dimLabel = new Gtk.Image({
                icon_name: "list-drag-handle-symbolic",
                tooltip_text: _("Move")
            });

            let motion = new Gtk.EventControllerMotion();
            this.dimLabel.add_controller(motion);

            motion.connect("enter", () => {
                let cursor = Gdk.Cursor.new_from_name("grab", null);
                this.otpRoot.window.set_cursor(cursor);
            });

            motion.connect("leave", () => {
                this.otpRoot.window.set_cursor(null);
            });

            this.add_prefix(this.dimLabel);

            this.add_suffix(this.edit);
            this.add_suffix(this.remove);
            this.add_suffix(this.exportBtn);
            this.add_suffix(this.code);
        } else {
            this.editMode = false;
            this.symbol = new Gtk.Image({
                icon_name: 'list-add-symbolic',
            });
            this.add_prefix(this.symbol)

            this.saveButton = new Gtk.Button({
                child: new Adw.ButtonContent({
                    label: _("Save"),
                    icon_name: 'document-save-symbolic',
                }),
                has_frame: false,
                valign: Gtk.Align.CENTER,
            });
            this.saveButton.set_action_name("");
            this.add_suffix(this.saveButton);
        }
    }

    _setRows() {
        this.usernameEntry = new Adw.EntryRow({
            title: _("Username"),
            text: this.otp ? this.otp.username : ""
        });

        this.issuerEntry = new Adw.EntryRow({
            title: _("Issuer"),
            text: this.otp ? this.otp.issuer : ""
        });

        this.secretEntry = new Adw.EntryRow({
            title: _("Secret"),
            text: this.otp ? this.otp.secret : ""
        });

        this.periodCombo = new Adw.ComboRow({
            title: _("Period"),
            model: new Gtk.StringList({
                strings: [_("30 seconds"), _("60 seconds")]
            })
        });

        this.digitsSpin = new Adw.SpinRow({
            title: _("Digits"),
            adjustment: new Gtk.Adjustment({
                lower: 6,
                upper: 8,
                step_increment: 1
            }),
            value: this.otp ? this.otp.digits : 6,
        });

        let algorithms = ["SHA1", "SHA256", "SHA512"]
        this.algorithmCombo = new Adw.ComboRow({
            title: _("Algorithm"),
            model: new Gtk.StringList ({
                strings: algorithms
            })
        });

        if (this.otp) {
            this.periodCombo.set_selected(this.otp.period == 30 ? 0 : 1);
            this.algorithmCombo.set_selected(algorithms.indexOf(this.otp.algorithm.toUpperCase()));
        }

        this.add_row(this.usernameEntry);
        this.add_row(this.issuerEntry);
        this.add_row(this.secretEntry);
        this.add_row(this.periodCombo);
        this.add_row(this.digitsSpin);
        this.add_row(this.algorithmCombo);
    }

    _edit() {
        this.set_enable_expansion(true);
        this.set_expanded(true);
        this.edit.set_tooltip_text(_("Save"));
        this.edit.set_icon_name("document-save-symbolic");
        this.edit.set_action_name("otpRow.save");
    }

    _new() {
        this.set_enable_expansion(true);
        this.saveButton.set_action_name("otpRow.save");
    }

    _save() {
        try {
            if (this.secretEntry.get_text() === "" | this.usernameEntry.get_text() === "")
                throw Error(_("Fields must be filled"));
            if (this.issuerEntry.get_text().indexOf("&") > -1)
                throw Error(_("Unaccepted character for issuer: '&amp;'"));
            Totp.base32hex(this.secretEntry.get_text());//Check secret code
            let otp = new Otp({
                "secret": this.secretEntry.get_text(),
                "issuer": this.issuerEntry.get_text() === "" ? "otp-key" : this.issuerEntry.get_text(),
                "username": this.usernameEntry.get_text(),
                "period": [30, 60][this.periodCombo.get_selected()],
                "digits": this.digitsSpin.get_value(),
                "algorithm": ["sha1", "sha256", "sha512"][this.algorithmCombo.get_selected()],
            });
            if (this.otp) {
                this.otpRoot.list.remove([this.otp.username, this.otp.issuer]);
            }
            if (this.otpRoot.lib.getOtp(this.otpRoot.lib.createId(otp.secret)) != null) //test availability
                throw _("Otp already available");
            this.otpRoot.lib.saveOtp(otp);
            this.otpRoot.list.append(otp);

            this.set_enable_expansion(false);
            this.set_expanded(false);
            if (this.editMode) {
                this.edit.set_tooltip_text(_("Edit"));
                this.edit.set_icon_name("document-edit-symbolic");
                this.edit.set_action_name("otpRow.edit");
            } else {
                this.saveButton.set_action_name("");
                //reset entries
                this.usernameEntry.set_text("");
                this.issuerEntry.set_text("");
                this.secretEntry.set_text("");
                this.periodCombo.set_selected(0);
                this.digitsSpin.set_value(6);
                this.algorithmCombo.set_selected(0);
            }
        } catch (e) {
            this.otpRoot.showToast(e.message);
        }
    }
}

class ImportOtpRowExpanded extends Adw.ExpanderRow {
    static {
        GObject.registerClass(this);

        this.install_action("otpRow.import", null, self => self._import());
        this.install_action("otpRow.save", null, self => self._save());
        this.install_action("otpRow.qrimage", null, self => self._qrimage());
        this.install_action("otpRow.qrcamera", null, self => self._qrcamera());
    }

    constructor(otpRoot) {
        super({
            activatable: true,
            action_name: "otpRow.import",
            expanded: false,
            enable_expansion: false,
            show_enable_switch: false,
            title: _("Import Secret")
        });

        this.otpRoot = otpRoot;

        this.setButtons()
        this.setRows()

        this.qrScanner = null;
    }

    setButtons() {
        this.symbol = new Gtk.Image({
            icon_name: 'document-revert-symbolic',
        });
        this.add_prefix(this.symbol)

        this.saveButton = new Gtk.Button({
            child: new Adw.ButtonContent({
                label: _("Save"),
                icon_name: 'document-save-symbolic',
            }),
            has_frame: false,
            valign: Gtk.Align.CENTER,
        });
        this.saveButton.set_action_name("");
        this.add_suffix(this.saveButton);

        this.qrImageButton = new Gtk.Button({
            child: new Adw.ButtonContent({
                tooltip_text: _("QR Image"),
                icon_name: "image-x-generic-symbolic",
            }),
            has_frame: false,
            valign: Gtk.Align.CENTER,
        });
        this.qrImageButton.set_action_name("otpRow.qrimage");
        this.add_suffix(this.qrImageButton);

        this.qrCameraButton = new Gtk.Button({
            child: new Adw.ButtonContent({
                tooltip_text: _("QR Camera"),
                icon_name: "camera-photo-symbolic",
            }),
            has_frame: false,
            valign: Gtk.Align.CENTER,
        });
        this.qrCameraButton.set_action_name("otpRow.qrcamera");
        this.add_suffix(this.qrCameraButton);
    }

    setRows() {
        this.otpUriEntry = new Adw.EntryRow({
            title: _("Secret Link"),
            text: "",
            input_purpose: Gtk.InputPurpose.URL
        });

        this.add_row(this.otpUriEntry);
    }

    _import() {
        this.set_enable_expansion(true);
        this.saveButton.set_action_name("otpRow.save");
    }

    _save(qr = false) {
        try {
            if (this.otpUriEntry.get_text() === "")
                throw Error(_("Fields must be filled"));
            let otp = this.otpRoot.lib.parseURL(this.otpUriEntry.get_text());
            Totp.base32hex(otp.secret);//Check secret code

            if (this.otpRoot.lib.getOtp(this.otpRoot.lib.createId(otp.secret)) != null) //test availability
                throw Error(_("Otp already available"));
            this.otpRoot.lib.saveOtp(otp);
            this.otpRoot.list.append(otp);

            this.set_enable_expansion(false);
            this.set_expanded(false);
            this.saveButton.set_action_name(null);
            this.otpUriEntry.set_text("");

            if (qr) {
                this.otpRoot.showToast(_("QR Code imported"));
            }
        } catch (e) {
            this.otpRoot.showToast(e.message);
        }
    }

    _qrimage() {
        let fileDialog = new Gtk.FileDialog({
            title: _("Select QR Image"),
            default_filter: new Gtk.FileFilter({
                name: "Images",
                mime_types: [
                    "image/png",
                    "image/bmp",
                    "image/jpeg"
                ],
            }),
        });
        fileDialog.open(this.otpRoot.window, null, (source, result, data) => {
            let file = fileDialog.open_finish(result);
            let img = GdkPixbuf.Pixbuf.new_from_file(file.get_path());
            img = img.add_alpha(false, 0, 0, 0);

            try {
                let code = jsQR(new Uint8ClampedArray(img.pixel_bytes.get_data()), img.width, img.height);

                if (code) {
                    this.otpUriEntry.set_text(code.data);
                    this._save(true);
                } else {
                    throw Error(_("Image does not contain QR Code"));
                }
            } catch (e) {
                this.otpRoot.showToast(e.message);
            }
        });
    }

    _qrcamera() {
        if (!this.qrScanner) {
            this.qrCameraButton.get_child().set_icon_name("media-record-symbolic");
            this.qrScanner = new QRScanner(this.otpRoot, (qrText) => {
                if (qrText) {
                    this.otpUriEntry.set_text(qrText);
                    this._save(true);
                } else {
                    this.otpRoot.showToast(_("QR Code not recognised"));
                }
                this.qrScanner = null;
                this.qrCameraButton.get_child().set_icon_name("camera-photo-symbolic");
            });
            try {
                this.qrScanner.start();
            } catch (e) {
                this.otpRoot.showToast(e.message);
                this.qrScanner = null;
                this.qrCameraButton.get_child().set_icon_name("camera-photo-symbolic");
            }
        } else {
            this.qrScanner.stop();
            this.qrScanner = null;
            this.qrCameraButton.get_child().set_icon_name("camera-photo-symbolic");
            this.otpRoot.showToast(_("QR Code Scan Stopped"));
        }
    }
}

class QRScanner {
    constructor(otpRoot, callback) {
        this.otpRoot = otpRoot;
        this._callback = callback;
        this._pipeline = null;
        this._appsink = null;
        this._pollId = 0;
    }

    start() {
        Gst.init(null);

        let devices = this.listVideoDevices();
        if (devices.length === 0) {
            throw Error(_("No camera found"));
        }

        this.otpRoot.showToast(_("QR Code Scan Started"));

        this._pipeline = Gst.parse_launch(
            'v4l2src ! videoconvert ! video/x-raw,format=RGB,width=640,height=480 ! appsink name=appsink sync=false'
        );

        let rawSink = this._pipeline.get_by_name('appsink');
        this._appsink = rawSink instanceof GstApp.AppSink
            ? rawSink
            : GstApp.AppSink.prototype.constructor.cast(rawSink);
        this._appsink.set_property('emit-signals', false);
        this._appsink.set_property('drop', true);
        this._appsink.set_property('max-buffers', 1);

        this._pipeline.set_state(Gst.State.PLAYING);

        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            let sample = this._appsink.pull_sample();
            if (!sample) {
                return GLib.SOURCE_CONTINUE;
            }
            let buffer = sample.get_buffer();
            let caps = sample.get_caps();
            let structure = caps.get_structure(0);
            let width = structure.get_value('width');
            let height = structure.get_value('height');
            let stride = width * 3;

            let [result, map] = buffer.map(Gst.MapFlags.READ);
            if (!result)
                return GLib.SOURCE_CONTINUE;

            let img = GdkPixbuf.Pixbuf.new_from_data(
                map.data,
                GdkPixbuf.Colorspace.RGB,
                false, // has_alpha
                8,     // bits_per_sample
                width,
                height,
                stride,
                null
            );
            img = img.add_alpha(false, 0, 0, 0);

            let pixelData = new Uint8ClampedArray(img.pixel_bytes.get_data());

            buffer.unmap(map);

            let qr = jsQR(pixelData, width, height);
            if (qr) {
                this._callback(qr.data);
                this.stop();
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._pollId !== 0) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }

        if (this._pipeline) {
            this._pipeline.set_state(Gst.State.NULL);
            this._pipeline = null;
        }
    }

    listVideoDevices() {
        let monitor = new Gst.DeviceMonitor();
        monitor.add_filter("Video/Source", null);
        monitor.start();

        let devices = monitor.get_devices();
        monitor.stop();

        return devices.map(device => device.get_display_name());
    }
}

export default class OtpKeysPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let otpRoot = new OtpRoot(this);
        otpRoot.setWindow(window);
        window.add(new OtpKeysSettingsPageWidget(otpRoot));
    }
}
