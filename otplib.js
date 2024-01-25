const { GLib, Secret } = imports.gi;

var OtpLib = class {
    constructor() {
        this._otpSchema = new Secret.Schema(
            "org.gnome.shell.extensions.otp-keys",
            Secret.SchemaFlags.NONE,
            {
                "username": Secret.SchemaAttributeType.STRING,
                "issuer": Secret.SchemaAttributeType.STRING
            }
        );
    }

    getOtp(username, issuer){
        let attr = {"username": username, "issuer": issuer};
        let otpURL = Secret.password_lookup_sync(this._otpSchema, attr, null);
        return otpURL === null ? null : this.parseURL(otpURL);
    }

    saveOtp(otp) {
        let attr = {"username": otp.username, "issuer": otp.issuer};
        return Secret.password_store_sync(this._otpSchema, attr,
            Secret.COLLECTION_DEFAULT, "otp-key", this.makeURL(otp), null);
    }

    removeOtp(otp) {
        let attr = {"username": otp.username, "issuer": otp.issuer};
        return Secret.password_clear_sync(this._otpSchema, attr, null);
    }

    isKeyringUnlocked() {
        const service = Secret.Service.get_sync(Secret.LOAD_COLLECTIONS, null);
        let defaultCol = Secret.Collection.for_alias_sync(service, Secret.COLLECTION_DEFAULT, null, null);
        return !defaultCol.locked;
    }

    unlockKeyring(parent) {
        let service = Secret.Service.get_sync(Secret.LOAD_COLLECTIONS, null);
        let collection = Secret.Collection.for_alias_sync(service, Secret.COLLECTION_DEFAULT, null, null);
        service.unlock_sync([collection], null);
    }

    parseURL(urlString) {
        let otp = {
            "username": "",
            "secret": "",
            "issuer": "otp-keys",
            "period": 30,
            "algorithm": "sha1",
            "digits": 6
        };
        let uri = GLib.Uri.parse(decodeURIComponent(urlString), GLib.UriFlags.NONE);
        if (uri.get_scheme() === "otpauth" & uri.get_host() === "totp") {
            let params = GLib.Uri.parse_params(uri.get_query(), -1, "&", GLib.UriParamsFlags.NONE);
            otp.secret = Object.keys(params).includes("secret") === true ? params.secret : "";
            otp.username = uri.get_path().replace("/", "");
            otp.issuer = Object.keys(params).includes("issuer") === true ? params.issuer : "otp-keys";
            otp.period = Object.keys(params).includes("period") === true ? params.period : 30;
            otp.digits = Object.keys(params).includes("digits") === true ? params.digits : 6;
            otp.algorithm = Object.keys(params).includes("algorithm") === true ? params.algorithm.toLowerCase() : "sha1";
            if (otp.secretcode != "") {
                return otp;
            }
            else {
                return GLib.UriError.FAILED;
            }
        }
        else {
            return GLib.UriError.BAD_SCHEME;
        }
    }

    makeURL(otp) {
        return "otpauth://totp/" + otp["username"] + "?" +
            "secret=" + otp.secret +
            "&issuer=" + otp.issuer +
            "&period=" + otp.period +
            "&algorithm=" + otp.algorithm.toUpperCase() +
            "&digits=" + otp.digits;
    }
}
