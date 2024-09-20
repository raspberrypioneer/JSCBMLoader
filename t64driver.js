//T64 special constants

const DIR_ENTRIES_LOW_HIGH = 34;
const TAPE_NAME_POS = 40;
const TAPE_DIR_START_POS = 64;

class t64driver {
	constructor(file) {

        this.type = "T64";
        this.fileRef = file;
        this.progName = file.name;
        this.progSize = file.size;
        this.subProgSize = 0;
        this.subProgPos = 0;
        this.dirPos = 0;
        this.dirEntryTotal = 0;
        this.dirListing = [];

        /*
            A directory listing entry has this structure
            dirEntry {
                byte c64sFileType          // C64S file type. Any non-zero is ok
                byte d64FileType           // D64 file type e.g. PRG, SEQ. Any non-zero is ok
                byte startAddressLowByte   // Start address of the file/program (low byte)
                byte startAddressHighByte  // Start address of the file/program (high byte)
                byte endAddressLowByte     // End address of the file/program (low byte)
                byte endAddressHighByte    // End address of the file/program (high byte)
                byte[2] unused1            // Not used
                long fileStartPos          // File start position on tape
                byte[4] unused2            // Not used
                byte[16] progName          // File/program name
            } // total of 32 bytes
        */

    }

    //Read binary file into byte array
	async readBinaryFile() {

		const buffer = await this.fileRef.arrayBuffer();  //Read file contents into array buffer
		this.progBytes = new Uint8Array(buffer);  //Get byte array for the array buffer
        this.dirEntryTotal = this.progBytes[DIR_ENTRIES_LOW_HIGH];
        this.dirEntryTotal |= this.progBytes[DIR_ENTRIES_LOW_HIGH+1] << 8;

    }  //readBinaryFile

    //Return buffer load of data from current program position
    async getBuffer() {

        const currentPos = this.subProgPos;
        const packetSize = Math.min((this.subProgSize - currentPos), MAX_BYTES_PER_REQUEST);
        this.subProgPos += packetSize;
        return {protocol: Uint8Array.from([(packetSize == MAX_BYTES_PER_REQUEST ? BUF_NORMAL : BUF_END), packetSize]), payload: this.subProgBytes.slice(currentPos, currentPos + packetSize)};

    }  //getBuffer

    //Create a directory list
    async buildDirectory() {

        const dirEntry = new Uint8Array(new ArrayBuffer(32));
        this.dirListing = [];

        //Add tape name
        dirEntry.set(this.progBytes.slice(TAPE_NAME_POS, TAPE_NAME_POS + 16),16);
        this.dirListing.push(Array.from(dirEntry));

        //Add directory entry lines
        let progPos = TAPE_DIR_START_POS;
        for (let i = 0; i < this.dirEntryTotal; i++) {
            dirEntry.set(this.progBytes.slice(progPos, progPos += 32));
            if (dirEntry[0] != 0 && dirEntry[1] != 0) {
                this.dirListing.push(Array.from(dirEntry));
            } 
        }

    }  //buildDirectory

    //Open program, by matching a program name in the directory list (or wildcard match), then set the program position to the resulting sector/track position
    async openProgram(bytesProgName) {

        const progName = String.fromCharCode(...bytesProgName).replace("\r", "").replace("\n", "");
        let found = false;

        //Check for a program name match in the directory (excluding the header entry)
        for (let i = 1; i < this.dirListing.length; i++) {
            const dirEntry = this.dirListing[i];
            const matchProgName = (String.fromCharCode(...dirEntry.slice(16,32))).trim();

            const pos = progName.indexOf("*");
            const matchPartial = pos > 0 ? matchProgName.substring(0, pos) + "*" : "!NOTFOUND!";

            //If wildcard character is used, set the program position to the first PRG entry
            if (progName == "*" || progName == matchProgName || progName == matchPartial) {
                this.progName = matchProgName;
                this.subProgSize = this.#fileLength(dirEntry)+2;  //Allow for the two start address bytes
                this.subProgPos = 0;

                //Setup the sub program array with the two start address bytes
                let progPos = this.#fileStartPos(dirEntry);
                this.subProgBytes = new Uint8Array(this.subProgSize);
                this.subProgBytes.set([dirEntry[2], dirEntry[3]]);
                this.subProgBytes.set(this.progBytes.slice(progPos, progPos + this.subProgSize-2), 2);
                found = true;
                break;
            }
        }
        return found;

    }  //openProgram

    //Return directory lines
    async getDirectoryLine() {

        const dirEntry = this.dirListing[this.dirPos];
        const fileBlocks = Math.ceil(this.#fileLength(dirEntry)/256);
        const blockHigh = (fileBlocks >> 8) & 0xFF;
        const blockLow = fileBlocks & 0xFF;

        let prefix = [];
        let suffix = [];
        if (this.dirPos == 0) {  //Disk header is reverse-video in quotes
            prefix = [REVERSE_CHAR, QUOTE_CHAR];
            suffix = [QUOTE_CHAR];
        }
        else {  //Normal entries are aligned after the block size, within quotes and end with the program type
            prefix = new Array(5-String(fileBlocks).length).fill(SPACE_CHAR).concat([QUOTE_CHAR]);
            suffix = [QUOTE_CHAR, SPACE_CHAR, SPACE_CHAR].concat(FILE_TYPES[(dirEntry[1] & 0x07)] || []);
        }

        //Assemble the line and return it
        const line = Uint8Array.from([blockLow,blockHigh].concat(prefix).concat(dirEntry.slice(16,32).map(this.#replaceNonBreakSpace)).concat(suffix));  //block size (2 bytes) and entry text
        if (this.dirPos >= this.dirListing.length-1) {  //Last directory entry
            this.dirPos = 0;
            return {protocol: Uint8Array.from([DIR_END, line.length]), payload: line};
        }
        else {
            this.dirPos += 1;
            return {protocol: Uint8Array.from([DIR_NORMAL, line.length]), payload: line};
        }

    }  //getDirectoryLine

    //Private method: Remove non breaking space character
    #replaceNonBreakSpace(element) {
        return element != NON_SPACE_CHAR ? element : SPACE_CHAR;
    }

    //Private method: Calculate the number of bytes of a file/program from the directory entry
    #fileLength(dirEntry) {
        return (dirEntry[4] | (dirEntry[5] << 8)) - (dirEntry[2] | (dirEntry[3] << 8));
    }

    //Private method: Calculate the start position of a file/program from the directory entry
    #fileStartPos(dirEntry) {
        let fileStartPos = 0;
        for (let b of [dirEntry[11], dirEntry[10], dirEntry[9], dirEntry[8]]) {
            // Shift previous value 8 bits to right and add it with next value
            fileStartPos = (fileStartPos << 8) + (b & 255);
        }
        return fileStartPos;
    }

}