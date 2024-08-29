// -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*-
const { Adw, Gio, GLib, GObject, Gtk, Gdk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Totp = Me.imports.totp;
const OtpLib = Me.imports.otplib;

const Gettext = imports.gettext;
const _ = Gettext.domain('otp-keys').gettext;

const SETTINGS_OTP_LIST = "secret-list";
const SETTINGS_NOTIFY = "notifications";
const SETTINGS_COPY_ICONS = "copy-icons";


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

    constructor(settings) {
        super();
        this._settings = settings;
        this._otpLib = new OtpLib.OtpLib();
        this.otpList = [];
        this.changedId =
            this._settings.connect(`changed::${SETTINGS_OTP_LIST}`,
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

        this._otpLib.removeOtp(this.otpList[pos]);
        this.otpList.splice(pos, 1);
        this._saveOtpList();

        this.items_changed(pos, 1, 0);
    }

    export(otpParams) {
        const clipboard = Gdk.Display.get_default().get_clipboard();
        const clipboardPrimary = Gdk.Display.get_default().get_primary_clipboard();

        this.otpList.forEach((otp) => {
            if (otp.username === otpParams[0] & otp.issuer === otpParams[1]) {
                let otpUrl = this._otpLib.makeURL(otp);
                clipboard.set(otpUrl);
                clipboardPrimary.set(otpUrl);
                return;
            }
        });
    }

    copyToClipboard(otpParams) {
        const clipboard = Gdk.Display.get_default().get_clipboard();
        const clipboardPrimary = Gdk.Display.get_default().get_primary_clipboard();

        this.otpList.forEach((otp) => {
            if (otp.username === otpParams[0] & otp.issuer === otpParams[1]) {
                let code = Totp.getCode(otp.secret, otp.digits, otp.period, otp.algorithm);
                clipboard.set(code);
                clipboardPrimary.set(code);
                return;
            }
        });
    }

    getOtp(secret) {
        let found = null;
        this.otpList.forEach((otp) => {
            if (otp.secret === secret) {
                found = otp;
            }
        });
        return found;
    }

    _saveOtpList() {
        this._settings.block_signal_handler(this.changedId);
        this._settings.set_strv(
            SETTINGS_OTP_LIST,
            this.otpList.map(otp => `${otp.username}:${otp.issuer}`)
        );
        this._settings.unblock_signal_handler(this.changedId)
    }

    _sync() {
        const removed = this.otpList.length;

        this.otpList = [];
        let migrated = false;
        if (this._otpLib.isKeyringUnlocked()) {
            for (let stringSecret of this._settings.get_strv(SETTINGS_OTP_LIST)) {
                let otp = {};
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
                    migrated = true;
                }

                let issuer = "otp-key";
                [username, issuer] = stringSecret.split(":");
                otp = this._otpLib.getOtp(username, issuer);
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

    constructor(settings) {
        super();
        let otpListWidget = new OtpKeysSecretListWidget(settings);
        this.add(otpListWidget);

        let settingsWidget = new OtpKeysSettingsWidget(settings);
        this.add(settingsWidget);
    }
}


class OtpKeysSecretListWidget extends Adw.PreferencesGroup {

    static {
        GObject.registerClass(this);

        this.install_action("otpList.add", null, self => self._addNewOtp());
        this.install_action("otpList.import", null, self => self._importNewOtp());
        this.install_action("otpList.export", "as", (self, name, param) => self.otpList.export(param.get_strv()));
        this.install_action("otpList.remove", "as", (self, name, param) => self.otpList.remove(param.get_strv()));
        this.install_action("otpList.copy", "as", (self, name, param) => self.otpList.copyToClipboard(param.get_strv()));
        this.install_action("otpList.edit", "as", (self, name, param) => self._editOtp(param.get_strv()));
        this.install_action("otpList.unlock_keyring", null, self => self._unlockKeyring());
    }

    constructor(settings) {
        super({
            title: _('Secrets'),
        });

        this.connect('unrealize', this._onUnrealize.bind(this));
        this.connect('destroy', this._onDestroy.bind(this));

        this._settings = settings;
        this._otpLib = new OtpLib.OtpLib();
        this.otpList = new OtpList(settings);

        this._list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        this.add(this._list);

        this._fillList();

        let interval = 30000 - (parseInt(new Date().getTime()) % 30000);
        if (this._delay == null) {
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

    _fillList() {
        const store = new Gio.ListStore({item_type: Gio.ListModel});
        const listModel = new Gtk.FlattenListModel({model: store});

        if (this._otpLib.isKeyringUnlocked()) {
            this.otpList._sync();
            store.append(this.otpList);
        }
        
        store.append(new NewItemModel());

        while (this._list.get_last_child() != null) {
            this._list.remove(this._list.get_last_child());
        }

        if (this._otpLib.isKeyringUnlocked()) {
            this._list.bind_model(listModel, item => {
                return item instanceof NewItem
                    ? new NewOtpRow()
                    : new OtpRow(item);
            });
        } else {
            this._list.bind_model(listModel, item => {
                return new OpenKeyringRow();
            });
        }
    }

    _addNewOtp() {
        const dialog = new NewSecretDialog(this.get_root(), this._settings);
        dialog.show();
    }

    _importNewOtp() {
        const dialog = new ImportOtpDilaog(this.get_root(), this._settings);
        dialog.show();
    }

    _editOtp(otp) {
        const dialog = new NewSecretDialog(this.get_root(), this._settings, this._otpLib.getOtp(otp[0], otp[1]));
        dialog.show();
    }

    _unlockKeyring() {
        this._otpLib.unlockKeyring(this);
        this._fillList();
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

class OtpKeysSettingsWidget extends Adw.PreferencesGroup{
    static {
        GObject.registerClass(this);
    }

    constructor(settings) {
        super({
            title: _("Settings")
        });

        this._settings = settings;

        this.showNotificationSwitch = new SwitchRow(_("Show Notifications"), SETTINGS_NOTIFY, settings)
        this.add(this.showNotificationSwitch);

        this.showCopyIconsSwitch = new SwitchRow(_("Show Copy Icons"), SETTINGS_COPY_ICONS, settings)
        this.add(this.showCopyIconsSwitch);
    }
}

class SwitchRow extends Adw.ActionRow{
    static {
        GObject.registerClass(this)
    }

    constructor(title, action, settings) {
        super({
            activatable: false,
            title: title
        });

        const sw = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        this.add_suffix(sw);

        settings.bind(action, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
}

class OtpRow extends Adw.ActionRow {
    static {
        GObject.registerClass(this);
    }

    constructor(otp) {
        super({
            activatable: false,
            title: otp.username,
        });

        const code = new Gtk.Button({
            label: this.human_readable_code(Totp.getCode(otp.secret, otp.digits, otp.period, otp.algorithm)),
            action_name: 'otpList.copy',
            action_target: new GLib.Variant('as', [otp.username, otp.issuer]),
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Copy")
        })
        this.add_suffix(code)

        const edit = new Gtk.Button({
            action_name: 'otpList.edit',
            action_target: new GLib.Variant('as', [otp.username, otp.issuer]),
            icon_name: 'document-edit-symbolic',
            has_frame: false,
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Edit")
        });
        this.add_suffix(edit);

        const exportBtn = new Gtk.Button({
            action_name: 'otpList.export',
            action_target: new GLib.Variant('as', [otp.username, otp.issuer]),
            icon_name: 'document-revert-symbolic-rtl',
            has_frame: false,
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Export")
        });
        this.add_suffix(exportBtn);

        const remove = new Gtk.Button({
            action_name: 'otpList.remove',
            action_target: new GLib.Variant('as', [otp.username, otp.issuer]),
            icon_name: 'edit-delete-symbolic',
            has_frame: false,
            valign: Gtk.Align.CENTER,
            tooltip_text: _("Remove")
        });
        this.add_suffix(remove);
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


class NewOtpRow extends Adw.ActionRow {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            activatable: false,
        });

        const newOtp = new Gtk.Button({
            action_name: 'otpList.add',
            child: new Adw.ButtonContent({
                label: _("Add Secret"),
                icon_name: 'list-add-symbolic',
            }),
            has_frame: false,
            valign: Gtk.Align.CENTER,
        });
        this.add_prefix(newOtp);

        const importOtp = new Gtk.Button({
            action_name: 'otpList.import',
            child: new Adw.ButtonContent({
                label: _("Import Secret"),
                icon_name: 'document-revert-symbolic',
            }),
            has_frame: false,
            valign: Gtk.Align.CENTER,
        });
        this.add_suffix(importOtp);
    }
}

class OpenKeyringRow extends Adw.ActionRow {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            activatable: true,
            action_name: 'otpList.unlock_keyring',
            title: _("Unlock Keyring")
        });
    }
}

class NewSecretDialog extends Gtk.Dialog {
    static {
        GObject.registerClass(this);

        this.install_action("otp.save", null, self => self._saveNewSecret());
    }

    constructor(parent, settings, otp = null) {
        super({
            title: otp === null ? _("New Secret") : _("Edit Secret"),
            transient_for: parent,
            modal: true,
            use_header_bar: true,
        });

        this._settings = settings;
        this._otpLib = new OtpLib.OtpLib();
        this.editMode = false;

        this.main = new Gtk.Grid({
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
            row_spacing: 12,
            column_spacing: 18,
            column_homogeneous: false,
            row_homogeneous: false
        });

        let usernameLabel = new Gtk.Label({label: _("Username"), halign: Gtk.Align.START});
        let issuerLabel = new Gtk.Label({label: _("Issuer"), halign: Gtk.Align.START});
        let secretLabel = new Gtk.Label({label: _("Secret Code"), halign: Gtk.Align.START});
        let periodLabel = new Gtk.Label({label: _("Epoc Time"), halign: Gtk.Align.START});
        let digitsLabel = new Gtk.Label({label: _("Digits"), halign: Gtk.Align.START});
        let hashlibLabel = new Gtk.Label({label: _("Algoritm"), halign: Gtk.Align.START});

        this.usernameEntry = new Gtk.Entry({
            halign: Gtk.Align.END,
            editable: true,
            visible: true,
            width_chars: 50
        });

        this.issuerEntry = new Gtk.Entry({
            halign: Gtk.Align.END,
            editable: true,
            visible: true,
            width_chars: 50
        });

        this.secretEntry = new Gtk.Entry({
            halign: Gtk.Align.END,
            editable: true,
            visible: true,
            width_chars: 50
        });

        this.period30SecToggle = new Gtk.ToggleButton({
            label: _("30 seconds"),
            active: true,
        });

        this.period60SecToggle = new Gtk.ToggleButton({
            label: _("60 seconds"),
            group: this.period30SecToggle,
        });

        this.digitsSpinner = new Gtk.SpinButton({
            halign: Gtk.Align.END,
            adjustment: new Gtk.Adjustment({
                lower: 6,
                upper: 8,
                step_increment: 1
            }),
            value: 6
        });

        this.algorithmToggleSha1 = new Gtk.ToggleButton({
            label: "SHA-1",
            active: true,
        });

        this.algorithmToggleSha256 = new Gtk.ToggleButton({
            label: "SHA-256",
            group: this.algorithmToggleSha1,
        });

        this.algorithmToggleSha512 = new Gtk.ToggleButton({
            label: "SHA-512",
            group: this.algorithmToggleSha1,
        });

        const addRow = ((main) => {
            let row = 0;
            return (label, input) => {
                let inputWidget = input;

                if (Array.isArray(input)) {
                    inputWidget = new Gtk.Box({
                        orientation: Gtk.Orientation.HORIZONTAL,
                        halign: Gtk.Align.END
                    });
                    input.forEach(widget => {
                        inputWidget.append(widget);
                    });
                }

                if (label) {
                    main.attach(label, 0, row, 1, 1);
                    main.attach(inputWidget, 1, row, 1, 1);
                }
                else {
                    main.attach(inputWidget, 0, row, 2, 1);
                }

                row++;
            };
        })(this.main);

        if (otp != null) {
            this.editMode = true;
            this.originalOtp = otp;
            this.usernameEntry.set_text(otp.username);
            this.issuerEntry.set_text(otp.issuer);
            this.secretEntry.set_text(otp.secret);
            if (otp.period === "30")
                this.period30SecToggle.set_active(true);
            else
                this.period60SecToggle.set_active(true);
            this.digitsSpinner.set_value(otp.digits);
            if (otp.algorithm === "sha1")
                this.algorithmToggleSha1.set_active(true);
            else if (otp.algorithm === "sha256")
                this.algorithmToggleSha256.set_active(true);
            else if (otp.algorithm === "sha512")
                this.algorithmToggleSha512.set_active(true);
        }

        addRow(usernameLabel, this.usernameEntry);
        addRow(issuerLabel, this.issuerEntry);
        addRow(secretLabel, this.secretEntry);
        addRow(periodLabel, [this.period30SecToggle, this.period60SecToggle]);
        addRow(digitsLabel, this.digitsSpinner);
        addRow(hashlibLabel, [this.algorithmToggleSha1, this.algorithmToggleSha256, this.algorithmToggleSha512]);

        this.set_child(this.main);

        this.saveButton = new Gtk.Button({
            label: _("Save"),
            action_name: "otp.save",
        });

        this.add_action_widget(this.saveButton, 1);
    }

    _saveNewSecret() {
        let otpList = new OtpList(this._settings);
        try {
            if (this.secretEntry.get_text() === "" | this.usernameEntry.get_text() === "")
                throw Error(_("Fields must be filled"));
            Totp.base32hex(this.secretEntry.get_text());//Check secret code
            let otp = new Otp({
                "secret": this.secretEntry.get_text(),
                "issuer": this.issuerEntry.get_text() === "" ? "otp-key" : this.issuerEntry.get_text(),
                "username": this.usernameEntry.get_text(),
                "period": this.period30SecToggle.get_active() ? 30 : 60,
                "digits": this.digitsSpinner.get_value(),
                "algorithm": this.algorithmToggleSha1.get_active() ? "sha1" : (this.algorithmToggleSha256.get_active() ? "sha256": "sha512"),
            });
            if (this.editMode) {
                otpList.remove([this.originalOtp.username, this.originalOtp.issuer]);
            }
            if (this._otpLib.getOtp(otp.username, otp.issuer) != null) //test availability
                throw "Otp already available";
            this._otpLib.saveOtp(otp);
            otpList.append(otp);
            this.close();
        } catch (e) {
            this.secretEntry.set_text("");
            this.secretEntry.set_placeholder_text(_("Please insert valid secret key"));
            this.usernameEntry.set_placeholder_text(_("Please insert a username"));
            if (e === "Otp already available") {
                this.usernameEntry.set_text("");
                this.usernameEntry.set_placeholder_text(_("Otp already available"));
            }
        }
    }
}

class ImportOtpDilaog extends Gtk.Dialog{
    static {
        GObject.registerClass(this);

        this.install_action("otp.save", null, self => self._saveNewSecret());
    }

    constructor(parent, settings) {
        super({
            title: _("Import Secret"),
            transient_for: parent,
            modal: true,
            use_header_bar: true,
        });

        this._settings = settings;
        this._otpLib = new OtpLib.OtpLib();
        
        this.main = new Gtk.Grid({
            margin_top: 10,
            margin_bottom: 10,
            margin_start: 10,
            margin_end: 10,
            row_spacing: 12,
            column_spacing: 18,
            column_homogeneous: false,
            row_homogeneous: false
        });

        let otpLabel = new Gtk.Label({label: "Secret URL", halign: Gtk.Align.START});
        
        this.otpEntry = new Gtk.Entry({
            halign: Gtk.Align.END,
            editable: true,
            visible: true,
            width_chars: 50,
            placeholder_text: "otpauth://..."
        });

        const addRow = ((main) => {
            let row = 0;
            return (label, input) => {
                let inputWidget = input;

                if (Array.isArray(input)) {
                    inputWidget = new Gtk.Box({
                        orientation: Gtk.Orientation.HORIZONTAL,
                        halign: Gtk.Align.END
                    });
                    input.forEach(widget => {
                        inputWidget.append(widget);
                    });
                }

                if (label) {
                    main.attach(label, 0, row, 1, 1);
                    main.attach(inputWidget, 1, row, 1, 1);
                }
                else {
                    main.attach(inputWidget, 0, row, 2, 1);
                }

                row++;
            };
        })(this.main);

        addRow(otpLabel, this.otpEntry);
        
        this.set_child(this.main);

        this.saveButton = new Gtk.Button({
            label: _("Save"),
            action_name: "otp.save",
        });

        this.add_action_widget(this.saveButton, 1);
    }

    _saveNewSecret() {
        let otpList = new OtpList(this._settings);
        try {
            if (this.otpEntry.get_text() === "")
                throw Error(_("Fields must be filled"));
            let otp = this._otpLib.parseURL(this.otpEntry.get_text());
            Totp.base32hex(otp.secret);//Check secret code
            
            if (this._otpLib.getOtp(otp.username, otp.issuer) != null) //test availability
                throw Error(_("Otp already available"));
            this._otpLib.saveOtp(otp);
            otpList.append(otp);
            this.close();
        } catch (e) {
            this.otpEntry.set_text("");
            this.otpEntry.set_placeholder_text(_("Please insert valid otp link"));
            if (e != null) {
                this.otpEntry.set_placeholder_text(e.message);
            }
        }
    }
}

function init() {
    let localeDir = Me.dir.get_child('locale');
    Gettext.bindtextdomain('otp-keys', localeDir.get_path());
}

/**
 * @returns {Gtk.Widget} - the prefs widget
 */
function buildPrefsWidget() {
    return new OtpKeysSettingsPageWidget(ExtensionUtils.getSettings("org.gnome.shell.extensions.otp-keys"));
}
