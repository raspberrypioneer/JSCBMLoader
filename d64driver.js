//D64 special constants

//Track start locations
//  17 with 21 sectors
//   7 with 19 sectors
//   6 with 18 sectors
//   5 with 17 sectors
//Each sector has 256 bytes
const TRACK_START_POS = 
[
    0, 5376, 10752, 16128, 21504, 26880, 32256, 37632, 43008, 48384, 53760, 59136, 64512, 69888, 75264, 80640, 86016, 
    91392, 96256, 101120, 105984, 110848, 115712, 120576, 
    125440, 130048, 134656, 139264, 143872, 148480, 
    153088, 157440, 161792, 166144, 170496
];

const BYTES_IN_SECTOR = 256;
const DISK_NAME_POS = TRACK_START_POS[17] + 144;  //Track 18, Sector 0, Disk name offset 142. (((17*21)*256))+144
const DIR_START_POS = TRACK_START_POS[17] + BYTES_IN_SECTOR;  //Track 18, Sector 1

class d64driver {
	constructor(file) {

        this.type = "D64";
        this.fileRef = file;
        this.progName = file.name;
        this.progSize = file.size;
        this.subProgSize = 0;
        this.progPos = 0;
        this.dirPos = 0;
        this.linkTrack = 0;
        this.linkSector = 0;
        this.dirListing = [];

        /*
            A directory listing entry has this structure
            dirEntry {
                byte linkTrack       // At the start of each block only, track and sector for the next directory block of max 8 entries
                byte linkSector      
                byte fileType        // Type of file within the D64 parent disk file, e.g. PRG, SEQ, REL
                byte startTrack      // Track and sector where the program starts
                byte startSector
                byte[16] progName    // File/program name
                byte sideTrack       // For REL files only (unused here)
                byte sideSector      // For REL files only (unused here)
                byte recordLength    // For REL files only (unused here)
                byte[6] unused       // For GEOS disks only (unused here)
                byte blocksLowByte   // File/program block size (low byte)
                byte blocksHighByte  // File/program block size (high byte)
            } // total of 32 bytes
        */

    }

    //Read binary file into byte array
	async readBinaryFile() {

		const buffer = await this.fileRef.arrayBuffer();  //Read file contents into array buffer
		this.progBytes = new Uint8Array(buffer);  //Get byte array for the array buffer

    }  //readBinaryFile

    //Return buffer load of data from current program position
    async getBuffer() {

        this.linkTrack = this.progBytes[this.progPos];
        this.linkSector = this.progBytes[this.progPos += 1];
        const currentPos = this.progPos += 1;
        if (this.linkTrack != 0 ) {
            //Position to the next block given by the link track/sector
            this.progPos = TRACK_START_POS[this.linkTrack-1] + (this.linkSector * BYTES_IN_SECTOR);
            //Return entire block data
            return {protocol: Uint8Array.from([BUF_NORMAL, MAX_BYTES_PER_REQUEST]), payload: this.progBytes.slice(currentPos, currentPos + MAX_BYTES_PER_REQUEST)};
        }
        else {
            // On the last block (no chain to another block), the sector byte holds the position of the last byte used in this block
            // linkSector is zero based (e.g. if equals 129, then 130 bytes are used in the block), so adjust packet size, data length and payload contents
            // Note that the track and sector (first 2 bytes, already read) are counted as bytes used, but are excluded in the payload sent
            return {protocol: Uint8Array.from([BUF_END, this.linkSector-1]), payload: this.progBytes.slice(currentPos, currentPos + this.linkSector-1)};
        }

    }  //getBuffer

    //Create a directory list
    async buildDirectory() {

        const dirEntry = new Uint8Array(new ArrayBuffer(32));
        this.dirListing = [];

        //Add disk name
        dirEntry.set(this.progBytes.slice(DISK_NAME_POS, DISK_NAME_POS + 16),5);
        this.dirListing.push(Array.from(dirEntry));

        //Add directory entry lines
        let progPos = DIR_START_POS;
        do {
            this.linkTrack = this.progBytes[progPos];
            this.linkSector = this.progBytes[progPos += 1];
            progPos --;

            //Get directory entries in block, max 8, each entry is 32 bytes
            for (let i = 0; i < 8; i++) {
                dirEntry.set(this.progBytes.slice(progPos, progPos += 32));
                if (dirEntry[2] > 0) {  //Only include non-deleted entries
                    this.dirListing.push(Array.from(dirEntry));
                }
            }

            //Continue to the next block given by the link track/sector
            if (this.linkTrack > 0) {
                progPos = TRACK_START_POS[this.linkTrack-1] + (this.linkSector * BYTES_IN_SECTOR);
            }

        } while (this.linkTrack > 0);

    }  //buildDirectory

    //Open program by finding it
    async openProgram(bytesProgName) {

        let progName = String.fromCharCode(...bytesProgName).replace("\r", "").replace("\n", "");
        let found = this.#findProgram(progName);

        //Match not found, try again with less strict criteria
        if (!found) {
            //Remove part of name after comma, example "BTSCORES,S" becomes "BTSCORES" (S means SEQ file type)
            const pos = progName.indexOf(",");
            if (pos > 0) {
                progName = progName.substring(0, pos);
                found = this.#findProgram(progName);
            }
        }
        return found;

    }  //openProgram

    //Return directory lines
    async getDirectoryLine() {

        const dirEntry = this.dirListing[this.dirPos];

        let prefix = [];
        let suffix = [];
        if (this.dirPos == 0) {  //Disk header is reverse-video in quotes
            prefix = [REVERSE_CHAR, QUOTE_CHAR];
            suffix = [QUOTE_CHAR];
        }
        else {  //Normal entries are aligned after the block size, within quotes and end with the program type
            const fileBlocks = dirEntry[30] | dirEntry[31] << 8;
            prefix = new Array(5-String(fileBlocks).length).fill(SPACE_CHAR).concat([QUOTE_CHAR]);
            suffix = [QUOTE_CHAR, SPACE_CHAR, SPACE_CHAR].concat(FILE_TYPES[(dirEntry[2] & 0x07)] || []);
        }

        //Assemble the line and return it
        const line = Uint8Array.from(dirEntry.slice(30,32).concat(prefix).concat(dirEntry.slice(5,21).map(this.#replaceNonBreakSpace)).concat(suffix));  //block size (2 bytes) and entry text
        if (this.dirPos >= this.dirListing.length-1) {  //Last directory entry
            this.dirPos = 0;
            return {protocol: Uint8Array.from([DIR_END, line.length]), payload: line};
        }
        else {
            this.dirPos += 1;
            return {protocol: Uint8Array.from([DIR_NORMAL, line.length]), payload: line};
        }

    }  //getDirectoryLine

    //Private method: Match a program name in the directory list (or wildcard match), then set the program position to the resulting sector/track position
    #findProgram(progName) {

        let found = false;

        //Check for a program name match in the directory (excluding the header entry)
        for (let i = 1; i < this.dirListing.length; i++) {
            const dirEntry = this.dirListing[i];
            const matchProgName = (String.fromCharCode(...dirEntry.slice(5,21))).trim();

            const pos = progName.indexOf("*");
            const matchPartial = pos > 0 ? matchProgName.substring(0, pos) + "*" : "!NOTFOUND!";

            //If wildcard character is used, set the program position to the first PRG entry
            if (progName == "*" || progName == matchProgName || progName == matchPartial) {
                if ([129,130,193,194].includes(dirEntry[2])) {  //type is SEQ, PRG, SEQ-locked, PRG-locked
                    this.linkTrack = dirEntry[3];
                    this.linkSector = dirEntry[4];
                    this.progName = matchProgName;
                    this.progPos = TRACK_START_POS[this.linkTrack-1] + (this.linkSector * BYTES_IN_SECTOR);
                    this.subProgSize = (dirEntry[30] + (dirEntry[31] << 8)) * (BYTES_IN_SECTOR-2);  //Block size less the track/sector bytes in each block
                    found = true;
                    break;
                }
            }
        }

        return found;

    }

    //Private method: Remove non breaking space character
    #replaceNonBreakSpace(element) {
        return element != NON_SPACE_CHAR ? element : SPACE_CHAR;
    }

}