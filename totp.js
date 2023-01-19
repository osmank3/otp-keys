const GLib = imports.gi.GLib;

//Converts a base32 string into a hex string. The padding is optional
//Based on the Pure JavaScript TOTP Code generator by Kevin Gut https://cable.ayra.ch/totp/
function base32hex(data) {
    //Basic argument validation
    if (typeof(data) !== typeof("")) {
        throw new Error("Argument to base32hex() is not a string");
    }
    if (data.length === 0) {
        throw new Error("Argument to base32hex() is empty");
    }
    if (!data.match(/^[A-Z2-7]+=*$/i)) {
        throw new Error("Argument to base32hex() contains invalid characters");
    }

    //Return value
    var ret = "";
    //Maps base 32 characters to their value (the value is the array index)
    var map = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".split('');
    //Split data into groups of 8
    var segments = (data.toUpperCase() + "========").match(/.{1,8}/g);
    //Adding the "=" in the line above creates an unnecessary entry
    segments.pop();
    //Calculate padding length
    var strip = segments[segments.length - 1].match(/=*$/)[0].length;
    //Too many '=' at the end. Usually a padding error due to an incomplete base32 string
    if (strip > 6) {
        throw new Error("Invalid base32 data (too much padding)");
    }
    //Process base32 in sections of 8 characters
    for (var i = 0; i < segments.length; i++) {
        //Start with empty buffer each time
        var buffer = 0;
        var chars = segments[i].split("");
        //Process characters individually
        for (var j = 0; j < chars.length; j++) {
            //This is the same as a left shift by 32 characters but without the 32 bit JS int limitation
            buffer *= map.length;
            //Map character to real value
            var index = map.indexOf(chars[j]);
            //Fix padding by ignoring it for now
            if (chars[j] === '=') {
                index = 0;
            }
            //Add real value
            buffer += index;
        }
        //Pad hex string to 10 characters (5 bytes)
        var hex = ("0000000000" + buffer.toString(16)).substr(-10);
        ret += hex;
    }
    //Remove bytes according to the padding
    switch (strip) {
    case 6:
        return ret.substr(0, ret.length - 8);
    case 4:
        return ret.substr(0, ret.length - 6);
    case 3:
        return ret.substr(0, ret.length - 4);
    case 1:
        return ret.substr(0, ret.length - 2);
    default:
        return ret;
    }
}

function hex2bytes(hex) {
    let bytes = [];
    for (let i=0; i < hex.length; i += 2) {
        let byte = parseInt(hex.substring(i, i+2), 16);
        if (byte > 127) {
            byte = -(~byte & 0xFF) - 1;
        }
        bytes.push(byte);
    }
    return bytes;
}

function getCode(key, size = 6, epoc = 30, hashlib = "sha1") {//hashlib: sha1,sha256,sha512
    let keyBytes = hex2bytes(base32hex(key));
    
    let now = parseInt(new Date().getTime() / 1000);
    let time = parseInt(now / epoc);
    let timehex = (time < 15.5 ? '0' : '') + Math.round(time).toString(16);

    while (timehex.length < 16) timehex = "0" + timehex;

    timeBytes = hex2bytes(timehex);

    let checksumType;
    switch (hashlib) {
        case "sha256":
            checksumType = GLib.ChecksumType.SHA256;
            break;
        case "sha512":
            checksumType = GLib.ChecksumType.SHA512;
            break;
        case "sha1":
        default:
            checksumType = GLib.ChecksumType.SHA1;
    }

    hash = hex2bytes(GLib.compute_hmac_for_bytes(checksumType, new GLib.Bytes(keyBytes), new GLib.Bytes(timeBytes)));

    let offset = hash[hash.length - 1] & 0xF;
    let code = ((hash[offset] & 0x7f) << 24) |
                        ((hash[offset + 1] & 0xff) << 16) |
                        ((hash[offset + 2] & 0xff) << 8) |
                        (hash[offset + 3] & 0xff);
    let otp = code % (10 ** size);
    otp = String(otp);
    while (otp.length < size) {
        otp = "0" + otp;
    }
    return otp
}
