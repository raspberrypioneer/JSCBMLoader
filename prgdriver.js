class prgdriver {
	constructor(file) {

        this.type = "PRG";
        this.fileRef = file;
        this.progName = file.name;
        this.progSize = file.size;
        this.subProgSize = file.size;
        this.blockSize = Math.ceil(file.size/256);

    }

    //Read binary file into byte array
	async readBinaryFile() {

		const buffer = await this.fileRef.arrayBuffer();  //Read file contents into array buffer
		this.progBytes = new Uint8Array(buffer);  //Get byte array for the array buffer

    }  //readBinaryFile

    //Return buffer load of data from current program position
    async getBuffer() {

        const currentPos = this.progPos;
        const packetSize = Math.min((this.progSize - currentPos), MAX_BYTES_PER_REQUEST);
        this.progPos += packetSize;
        return {protocol: Uint8Array.from([(packetSize == MAX_BYTES_PER_REQUEST ? BUF_NORMAL : BUF_END), packetSize]), payload: this.progBytes.slice(currentPos, currentPos + packetSize)};

    }  //getBuffer

    //Return directory line
    async getDirectoryLine() {

        const blockHigh = (this.blockSize >> 8) & 0xFF;
        const blockLow = this.blockSize & 0xFF;
        return {protocol: Uint8Array.from([DIR_END, this.progName.length+2]), payload: Uint8Array.from([blockLow,blockHigh].concat(Array.from(new TextEncoder().encode(this.progName.toUpperCase()))))};

    }  //getDirectoryLine
    
    //Open program, just position reset is required
    async openProgram(bytesProgName) {

        this.progPos = 0;
        return true;

    }  //openProgram

}