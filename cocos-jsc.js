Java.perform(function() {
    console.log("[*] Script loaded");

    const GZIPInputStream = Java.use("java.util.zip.GZIPInputStream");
    const ByteArrayInputStream = Java.use("java.io.ByteArrayInputStream");
    const ByteArrayOutputStream = Java.use("java.io.ByteArrayOutputStream");

    var LAST_OPENED_jsc_FILE = null;
    var FIRST_DETECT = true;

    function saveToFile(data, fileName) {
        try {
            const buffer = new Uint8Array(data).buffer;
            const fs = new File(`/sdcard/Download/${fileName}`, "wb");
            fs.write(buffer);
            fs.flush();
            fs.close();
            console.log(`[+] Saved to /sdcard/Download/${fileName}`);
            return true;
        } catch (e) {
            console.log("[-] Save failed:", e);
            return false;
        }
    }

    function decompressGZIP(data) {
        try {
            const inArray = Java.array('byte', Array.from(new Uint8Array(data)));
            const inStream = ByteArrayInputStream.$new(inArray);
            const gzipStream = GZIPInputStream.$new(inStream);
            const outStream = ByteArrayOutputStream.$new();
            
            const buffer = Java.array('byte', new Array(4096).fill(0));
            let len;
            while ((len = gzipStream.read(buffer, 0, buffer.length)) > 0) {
                outStream.write(buffer, 0, len);
            }
            
            const result = outStream.toByteArray();
            gzipStream.close();
            outStream.close();
    
            return Java.array('byte', result);
        } catch (e) {
            console.log("[-] GZIP decompression failed:", e);
            return null;
        }
    }

    // Track all JSC file operations
    Interceptor.attach(Module.findExportByName(null, 'open'), {
        onEnter: function(args) {
            var filePath = Memory.readUtf8String(args[0]);
            if (filePath && filePath.includes(".jsc")) {
                LAST_OPENED_jsc_FILE = filePath;
                console.log("[*] Detected .jsc file opened:", filePath);
            }
        }
    });

    const dlopen = Module.findExportByName(null, "android_dlopen_ext");
    if (dlopen) {
        Interceptor.attach(dlopen, {
            onEnter: function(args) {
                this.libName = Memory.readUtf8String(args[0]);
            },
            onLeave: function(retval) {
                if (this.libName && this.libName.includes("libcocos2djs.so")) {
                    hookXXTEA();
                }
            }
        });

        function hookXXTEA() {
            const xxteaDecryptFunc = Module.findExportByName("libcocos2djs.so", "xxtea_decrypt");
            if (!xxteaDecryptFunc) return;
        
            Interceptor.attach(xxteaDecryptFunc, {
                onEnter: function(args) {
                    this.inputLength = args[1].toInt32();
                    this.outLenPtr = args[4];
                },
                onLeave: function(retval) {
                    try {
                        const decryptedLength = this.outLenPtr.readU32();
                        if (decryptedLength <= 0) return;
        
                        const decryptedData = retval.readByteArray(decryptedLength);
                        if (!decryptedData) return;
        
                        const header = new Uint8Array(decryptedData.slice(0, 3));
                        if (header[0] === 0x1f && header[1] === 0x8b && header[2] === 0x08) {
                            const decompressed = decompressGZIP(decryptedData);
                            if (decompressed) {
                                const fileName = LAST_OPENED_jsc_FILE ? 
                                    `${LAST_OPENED_jsc_FILE.split('/').pop()}.decrypted.js` : 
                                    `decrypted_${getTimestamp()}.js`;
                                saveToFile(decompressed, fileName);
                            }
                        }
                    } catch (e) {
                        console.log("[-] Error:", e);
                    }
                }
            });
        }

        function getTimestamp() {
            return new Date().getTime();
        }
    }
});

