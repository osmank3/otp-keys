import GLib from 'gi://GLib';

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PADDING_CHAR = "=";

//Converts a base32 string into a hex string. The padding is optional
//Based on the Pure JavaScript TOTP Code generator by Kevin Gut https://cable.ayra.ch/totp/
export function base32hex(data) {
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
    let ret = "";
    //Split data into groups of 8
    let segments = (data.toUpperCase() + PADDING_CHAR * 8).match(/.{1,8}/g);
    //Adding the "=" in the line above creates an unnecessary entry
    segments.pop();
    //Calculate padding length
    let strip = segments[segments.length - 1].match(/=*$/)[0].length;
    //Too many '=' at the end. Usually a padding error due to an incomplete base32 string
    if (strip > 6) {
        throw new Error("Invalid base32 data (too much padding)");
    }
    //Process base32 in sections of 8 characters
    for (let i = 0; i < segments.length; i++) {
        //Start with empty buffer each time
        let buffer = 0;
        let chars = segments[i].split("");
        //Process characters individually
        for (let j = 0; j < chars.length; j++) {
            //This is the same as a left shift by 32 characters but without the 32 bit JS int limitation
            buffer *= BASE32_ALPHABET.length;
            //Map character to real value
            let index = BASE32_ALPHABET.indexOf(chars[j]);
            //Fix padding by ignoring it for now
            if (chars[j] === '=') {
                index = 0;
            }
            //Add real value
            buffer += index;
        }
        //Pad hex string to 10 characters (5 bytes)
        let hex = ("0000000000" + buffer.toString(16)).substr(-10);
        ret += hex;
    }
    //Remove bytes according to the padding
    switch (strip) {
    case 6:
        return ret.substring(0, ret.length - 8);
    case 4:
        return ret.substring(0, ret.length - 6);
    case 3:
        return ret.substring(0, ret.length - 4);
    case 1:
        return ret.substring(0, ret.length - 2);
    default:
        return ret;
    }
}

export function decimals2base32(decimals) {
    if (!decimals || decimals.length === 0) {
        return "";
    }

    const buffer = new Uint8Array(decimals);

    let base32String = "";
    let bitPosition = 0;
    const totalBits = buffer.length * 8;

    while (bitPosition < totalBits) {
        const byteIndex = Math.floor(bitPosition / 8);
        const bitIndexInByte = bitPosition % 8;

        const byte1 = buffer[byteIndex];
        const byte2 = (byteIndex + 1 < buffer.length) ? buffer[byteIndex + 1] : 0;

        const word = (byte1 << 8) | byte2;

        // `16 - bitIndexInByte - 5`
        const shift = 11 - bitIndexInByte;
        const index = (word >> shift) & 0x1F;

        base32String += BASE32_ALPHABET[index];
        bitPosition += 5;
    }

    const paddingCount = (8 - (base32String.length % 8)) % 8;
    base32String += PADDING_CHAR.repeat(paddingCount);

    return base32String;
}

export function hex2bytes(hex) {
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

export function getCode(key, size = 6, epoc = 30, hashlib = "sha1") {//hashlib: sha1,sha256,sha512
    let keyBytes = hex2bytes(base32hex(key));

    let now = parseInt(new Date().getTime() / 1000);
    let time = parseInt(now / epoc);
    let timehex = (time < 15.5 ? '0' : '') + Math.round(time).toString(16);

    while (timehex.length < 16) timehex = "0" + timehex;

    let timeBytes = hex2bytes(timehex);

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

    let hash = hex2bytes(GLib.compute_hmac_for_bytes(checksumType, new GLib.Bytes(keyBytes), new GLib.Bytes(timeBytes)));

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
