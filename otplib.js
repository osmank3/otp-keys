import GLib from 'gi://GLib';
import Secret from 'gi://Secret';

import './vendor/protobuf-bundle.js';
import {decimals2base32} from "./totp.js";

const ALGORITHM = {
  0: "unspecified",
  1: "sha1",
  2: "sha256",
  3: "sha512",
  4: "md5",
};

const DIGIT_COUNT = {
  0: "unspecified",
  1: 6,
  2: 8,
};

const OTP_TYPE = {
  0: "unspecified",
  1: "hotp",
  2: "totp",
};

export default class OtpLib {
    constructor() {
        this._oldOtpSchema = new Secret.Schema(
            "org.gnome.shell.extensions.otp-keys",
            Secret.SchemaFlags.NONE,
            {
                "username": Secret.SchemaAttributeType.STRING,
                "issuer": Secret.SchemaAttributeType.STRING
            }
        );
        this._otpSchema = new Secret.Schema(
            "org.gnome.shell.extensions.otp-keys",
            Secret.SchemaFlags.NONE,
            {
                "otpId": Secret.SchemaAttributeType.STRING
            }
        );
    }

    createId(data) {
        let bytes = new TextEncoder().encode(data);
        let checksum = new GLib.Checksum(GLib.ChecksumType.SHA1);
        checksum.update(bytes);
        return checksum.get_string();
    }

    getOldOtp(username, issuer){
        let attr = {"username": username, "issuer": issuer};
        let otpURL = Secret.password_lookup_sync(this._oldOtpSchema, attr, null);
        return otpURL === null ? null : this.parseURL(otpURL);
    }

    getOtp(id){
        let attr = {"otpId": id};
        let otpURL = Secret.password_lookup_sync(this._otpSchema, attr, null);
        return otpURL === null ? null : this.parseURL(otpURL);
    }

    saveOtp(otp) {
        let attr = {"otpId": this.createId(otp.secret)};
        return Secret.password_store_sync(this._otpSchema, attr,
            Secret.COLLECTION_DEFAULT, "otp-key", this.makeURL(otp), null);
    }

    removeOtp(otp, isOld = false) {
        let attr;
        if (isOld) {
            attr = {"username": otp.username, "issuer": otp.issuer};
            return Secret.password_clear_sync(this._oldOtpSchema, attr, null);
        }
        attr = {"otpId": this.createId(otp.secret)};
        return Secret.password_clear_sync(this._otpSchema, attr, null);
    }

    isKeyringUnlocked() {
        const service = Secret.Service.get_sync(Secret.ServiceFlags.LOAD_COLLECTIONS, null);
        let defaultCol = Secret.Collection.for_alias_sync(service, Secret.COLLECTION_DEFAULT, null, null);
        return !defaultCol.locked;
    }

    unlockKeyring(parent) {
        //Add a test key to the keyring for unlocking keyring
        let attr = {"otpId": "testValue"};
        Secret.password_store(this._otpSchema, attr,
            Secret.COLLECTION_DEFAULT, "otp-key-test", "test value", null, (source, result, data) => {
            if (this.isKeyringUnlocked()) {
                parent._fillList();
                Secret.password_clear_sync(this._otpSchema, attr, null);//Remove test key from keyring
            }
        });
    }

    parseURL(urlString) {
        let otp = {
            "username": "",
            "secret": "",
            "issuer": "otp-keys",
            "period": 30,
            "algorithm": "sha1",
            "digits": 6,
            "type": "totp"
        };
        let uri = GLib.Uri.parse(decodeURIComponent(urlString), GLib.UriFlags.NONE);
        if (uri.get_scheme() === "otpauth") {
            let params = GLib.Uri.parse_params(uri.get_query(), -1, "&", GLib.UriParamsFlags.NONE);
            otp.secret = Object.keys(params).includes("secret") ? params.secret : "";
            otp.username = uri.get_path().replace("/", "");
            otp.issuer = Object.keys(params).includes("issuer") ? params.issuer : "otp-keys";
            otp.digits = Object.keys(params).includes("digits") ? params.digits : 6;
            otp.algorithm = Object.keys(params).includes("algorithm") ? params.algorithm.toLowerCase() : "sha1";
            otp.type = uri.get_host() !== "" ? uri.get_host() : "totp";
            if (otp.type === "hotp") {
                otp.counter = Object.keys(params).includes("counter") ? params.counter : 0;
            } else {
                otp.period = Object.keys(params).includes("period") ? params.period : 30;
            }

        } else if (uri.get_scheme() === "otpauth-migration") {
            let params = GLib.Uri.parse_params(uri.get_query(), -1, "&", GLib.UriParamsFlags.NONE);
            let data = Object.keys(params).includes("data") ? params.data : null;
            if (data !== null) {
                let migrationPayload = MigrationPayloadRoot.MigrationPayload;
                let decodedOtpPayload = migrationPayload.decode(
                    GLib.base64_decode(data)
                );

                if (decodedOtpPayload.otpParameters && decodedOtpPayload.otpParameters.length > 0) {
                    let otpParams = decodedOtpPayload.otpParameters[0];
                    otp.secret = Object.keys(otpParams).includes("secret") ? decimals2base32(otpParams.secret) : "";
                    otp.username = Object.keys(otpParams).includes("name") ? otpParams.name : "";
                    otp.issuer = Object.keys(otpParams).includes("issuer") ? otpParams.issuer : "";
                    otp.digits = Object.keys(otpParams).includes("digits") ? DIGIT_COUNT[otpParams.digits] : 6;
                    otp.algorithm = Object.keys(otpParams).includes("algorithm") ? ALGORITHM[otpParams.algorithm] : "sha1";
                    otp.type = Object.keys(otpParams).includes("type") ? OTP_TYPE[otpParams.type] : "totp";
                    if (otp.type === "totp") {
                        otp.period = 30;
                    } else {
                        otp.counter = otpParams.counter;
                    }
                }
            }
        }
        else {
            return GLib.UriError.BAD_SCHEME;
        }

        if (otp.secret !== "") {
            return otp;
        }
        else {
            return GLib.UriError.FAILED;
        }
    }

    makeURL(otp) {
        let uri = "otpauth://" +  otp.type  + "/" + otp.username + "?" +
            "secret=" + otp.secret +
            "&issuer=" + otp.issuer +
            "&algorithm=" + otp.algorithm.toUpperCase() +
            "&digits=" + otp.digits;
        if (otp.type === "hotp") {
            uri = uri + "&counter=" + otp.counter;
        } else {
            uri = uri + "&period=" + otp.period;
        }
        return uri;
    }
}
