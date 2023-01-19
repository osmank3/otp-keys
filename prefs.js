// -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*-

const { Adw, Gio, GLib, GObject, Gtk, Gdk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Totp = Me.imports.totp;
const clipboard = Gdk.Display.get_default().get_clipboard();
const clipboardPrimary = Gdk.Display.get_default().get_primary_clipboard();

const Gettext = imports.gettext;
const _ = Gettext.domain('gnome-shell-otp').gettext;

const SETTINGS_KEY = "secret-list";


class NewItem extends GObject.Object {}
GObject.registerClass(NewItem);


class NewItemModel extends GObject.Object {
    static [GObject.interfaces] = [Gio.ListModel];
    static {
        GObject.registerClass(this);
    }

    #item = new NewItem();

    vfunc_get_item_type() {
        return NewItem;
    }

    vfunc_get_n_items() {
        return 1;
    }

    vfunc_get_item(_pos) {
        return this.#item;
    }
}


class Secret extends GObject.Object {
    static [GObject.properties] = {
        secretcode: GObject.ParamSpec.string(
            "secretcode", "secretcode", "secretcode",
            GObject.ParamFlags.READWRITE,
            null
        ),
        username: GObject.ParamSpec.string(
            "username", "username", "username",
            GObject.ParamFlags.READWRITE,
            null
        ),
        epoctime: GObject.ParamSpec.string(
            "epoctime", "epoctime", "epoctime",
            GObject.ParamFlags.READWRITE,
            "30"
        ),
        digits: GObject.ParamSpec.string(
            "digits", "digits", "digits",
            GObject.ParamFlags.READWRITE,
            "6"
        ),
        hashlib: GObject.ParamSpec.string(
            "hashlib", "hashlib", "hashlib",
            GObject.ParamFlags.READWRITE,
            "sha1"
        )
    };
    
    static {
        GObject.registerClass(this);
    }
    
    constructor(secret) {
        super();
        this.secretcode = secret.secretcode;
        this.username = secret.username;
        this.epoctime = secret.epoctime;
        this.digits = secret.digits;
        this.hashlib = secret.hashlib;
    }
}


class SecretsList extends GObject.Object {
    static [GObject.interfaces] = [Gio.ListModel];
    static {
        GObject.registerClass(this);
    }
    
    #settings = ExtensionUtils.getSettings("org.gnome.shell.extensions.gnome-shell-otp");
    #secrets = [];
    #changedId;
    
    constructor() {
        super();
        this.#changedId =
            this.#settings.connect(`changed::${SETTINGS_KEY}`,
                () => this.#sync());
        this.#sync();
    }
    
    append(secret) {
        const pos = this.#secrets.length;
        
        this.#secrets.push(new Secret({
            secretcode: secret.secretcode,
            username: secret.username,
            epoctime: secret.epoctime,
            digits: secret.digits,
            hashlib: secret.hashlib
        }));
        this.#saveSecrets();
        
        this.items_changed(pos, 0, 1);
    }
    
    remove(secretcode) {
        const pos = this.#secrets.findIndex(s => s.secretcode === secretcode);
        if (pos < 0)
            return;
        
        this.#secrets.splice(pos, 1);
        this.#saveSecrets();
        
        this.items_changed(pos, 1, 0);
    }
    
    copyToClipboard(secretcode) {
        this.#secrets.forEach((s) => {
            if (s.secretcode === secretcode) {
                let code = Totp.getCode(s.secretcode, s.digits, s.epoctime, s.hashlib);
                clipboard.set(code);
                clipboardPrimary.set(code);
                return;
            }
        });
    }
    
    getSecret(secretcode) {
        let found = null;
        this.#secrets.forEach((s) => {
            if (s.secretcode === secretcode) {
                found = s;
            }
        });
        return found;
    }
    
    #saveSecrets() {
        this.#settings.block_signal_handler(this.#changedId);
        this.#settings.set_strv(
            SETTINGS_KEY,
            this.#secrets.map(s => `${s.secretcode}:${s.username}:${s.epoctime}:${s.digits}:${s.hashlib}`)
        );
        this.#settings.unblock_signal_handler(this.#changedId)
    }
    
    #sync() {
        const removed = this.#secrets.length;
        
        this.#secrets = [];
        for (const stringSecret of this.#settings.get_strv(SETTINGS_KEY)) {
            const [secretcode, username, epoctime, digits, hashlib] = stringSecret.split(":");
            const secret = {
                "secretcode": secretcode,
                "username": username,
                "epoctime": epoctime,
                "digits": digits,
                "hashlib": hashlib
            };
            this.#secrets.push(new Secret(secret));
        }
        this.items_changed(0, removed, this.#secrets.length);
    }
    
    vfunc_get_item_type() {
        return Secret;
    }
    
    vfunc_get_n_items() {
        return this.#secrets.length;
    }

    vfunc_get_item(pos) {
        return this.#secrets[pos] ?? null;
    }
}


class GnomeShellOtpSettingsWidget extends Adw.PreferencesGroup {
    static {
        GObject.registerClass(this);
        
        this.install_action("secrets.add", null, self => self._addNewSecret());
        this.install_action("secrets.remove", "s", (self, name, param) => self._secrets.remove(param.unpack()));
        this.install_action("secrets.copy", "s", (self, name, param) => self._secrets.copyToClipboard(param.unpack()));
        this.install_action("secrets.edit", "s", (self, name, param) => self._editSecret(self._secrets.getSecret(param.unpack())));
    }
    
    constructor() {
        super({
            title: _('Secrets'),
        });
        
        this._secrets = new SecretsList();
        
        
        this._list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        this.add(this._list);
        
        
        this._fillList();
        
        let interval = 30 - (parseInt(new Date().getTime() / 1000) % 30);
        setTimeout(
            () => {
                this._fillList();
                setInterval(
                    () => {
                        this._fillList();
                    },
                    30000
                );
            },
            interval * 1000
        );
    }
    
    _fillList() {
        const store = new Gio.ListStore({item_type: Gio.ListModel});
        const listModel = new Gtk.FlattenListModel({model: store});
        store.append(this._secrets);
        store.append(new NewItemModel());
        
        while (this._list.get_last_child() != null) {
            this._list.remove(this._list.get_last_child());
        }
        
        this._list.bind_model(listModel, item => {
            return item instanceof NewItem
                ? new NewSecretRow()
                : new SecretRow(item);
        });
        
    }
    
    _addNewSecret() {
        const dialog = new NewSecretDialog(this.get_root());
        dialog.show();
    }
    
    _editSecret(secret) {
        const dialog = new NewSecretDialog(this.get_root(), secret);
        dialog.show();
    }
}


class SecretRow extends Adw.ActionRow {
    static {
        GObject.registerClass(this);
    }

    constructor(secret) {
        super({
            activatable: false,
            title: secret.username,
        });
        
        const code = new Gtk.Button({
            label: this.human_readable_code(Totp.getCode(secret.secretcode, secret.digits, secret.epoctime, secret.hashlib)),
            action_name: 'secrets.copy',
            action_target: new GLib.Variant('s', secret.secretcode),
            valign: Gtk.Align.CENTER,
        })
        this.add_suffix(code)
        
        const edit = new Gtk.Button({
            action_name: 'secrets.edit',
            action_target: new GLib.Variant('s', secret.secretcode),
            icon_name: 'document-edit-symbolic',
            has_frame: false,
            valign: Gtk.Align.CENTER,
        });
        this.add_suffix(edit);

        const button = new Gtk.Button({
            action_name: 'secrets.remove',
            action_target: new GLib.Variant('s', secret.secretcode),
            icon_name: 'edit-delete-symbolic',
            has_frame: false,
            valign: Gtk.Align.CENTER,
        });
        this.add_suffix(button);
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


class NewSecretRow extends Gtk.ListBoxRow {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            action_name: 'secrets.add',
            child: new Gtk.Image({
                icon_name: 'list-add-symbolic',
                pixel_size: 16,
                margin_top: 12,
                margin_bottom: 12,
                margin_start: 12,
                margin_end: 12,
            }),
        });
        this.update_property(
            [Gtk.AccessibleProperty.LABEL], [_('Add Secret')]);
    }
}

class NewSecretDialog extends Gtk.Dialog {
    static {
        GObject.registerClass(this);
        
        this.install_action("secret.save", null, self => self._saveNewSecret());
    }
    
    constructor(parent, secret = null) {
        super({
            title: _("New Secret"),
            transient_for: parent,
            modal: true,
            use_header_bar: true,
        });
        
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
        let secretLabel = new Gtk.Label({label: _("Secret Code"), halign: Gtk.Align.START});
        let epoctimeLabel = new Gtk.Label({label: _("Epoc Time"), halign: Gtk.Align.START});
        let digitsLabel = new Gtk.Label({label: _("Digits"), halign: Gtk.Align.START});
        let hashlibLabel = new Gtk.Label({label: _("Algoritm"), halign: Gtk.Align.START});
        
        this.usernameEntry = new Gtk.Entry({
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
        
        this.epoctime30SecToggle = new Gtk.ToggleButton({
            label: _("30 seconds"),
            active: true,
        });
        
        this.epoctime60SecToggle = new Gtk.ToggleButton({
            label: _("60 seconds"),
            group: this.epoctime30SecToggle,
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
        
        this.hashlibToggleSha1 = new Gtk.ToggleButton({
            label: "SHA-1",
            active: true,
        });
        
        this.hashlibToggleSha256 = new Gtk.ToggleButton({
            label: "SHA-256",
            group: this.hashlibToggleSha1,
        });
        
        this.hashlibToggleSha512 = new Gtk.ToggleButton({
            label: "SHA-512",
            group: this.hashlibToggleSha1,
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
        
        
        if (secret != null) {
            this.editMode = true;
            this.originalSecret = secret.secretcode;
            this.usernameEntry.set_text(secret.username);
            this.secretEntry.set_text(secret.secretcode);
            if (secret.epoctime === "30")
                this.epoctime30SecToggle.set_active(true);
            else
                this.epoctime60SecToggle.set_active(true);
            this.digitsSpinner.set_value(secret.digits);
            if (secret.hashlib === "sha1")
                this.hashlibToggleSha1.set_active(true);
            else if (secret.hashlib === "sha256")
                this.hashlibToggleSha256.set_active(true);
            else if (secret.hashlib === "sha512")
                this.hashlibToggleSha512.set_active(true);
        }
        
        addRow(usernameLabel, this.usernameEntry);
        addRow(secretLabel, this.secretEntry);
        addRow(epoctimeLabel, [this.epoctime30SecToggle, this.epoctime60SecToggle]);
        addRow(digitsLabel, this.digitsSpinner);
        addRow(hashlibLabel, [this.hashlibToggleSha1, this.hashlibToggleSha256, this.hashlibToggleSha512]);
        
        this.set_child(this.main);
        
        this.saveButton = new Gtk.Button({
            label: _("Save"),
            action_name: "secret.save",
        });
        
        this.add_action_widget(this.saveButton, 1);
    }
    
    _saveNewSecret() {
        let secrets = new SecretsList();
        try {
            if (this.secretEntry.get_text() === "" | this.usernameEntry.get_text() === "")
                throw Error(_("Fields must be filled"));
            let secretText = Totp.base32hex(this.secretEntry.get_text());//Check secret code
            if (this.editMode) {
                secrets.remove(this.originalSecret);
            }
            let secret = new Secret({
                "secretcode": this.secretEntry.get_text(),
                "username": this.usernameEntry.get_text(),
                "epoctime": this.epoctime30SecToggle.get_active() ? 30 : 60,
                "digits": this.digitsSpinner.get_value(),
                "hashlib": this.hashlibToggleSha1.get_active() ? "sha1" : (this.hashlibToggleSha256.get_active() ? "sha256": "sha512"),
            });
            secrets.append(secret);
            this.close();
        } catch (e) {
            this.secretEntry.set_text("");
            this.secretEntry.set_placeholder_text(_("Please insert valid secret key"));
            this.usernameEntry.set_placeholder_text(_("Please insert a username"));
        }
    }
}

function init() {
    let localeDir = Me.dir.get_child('locale');
    Gettext.bindtextdomain('gnome-shell-otp', localeDir.get_path());
}

/**
 * @returns {Gtk.Widget} - the prefs widget
 */
function buildPrefsWidget() {
    return new GnomeShellOtpSettingsWidget();
}




