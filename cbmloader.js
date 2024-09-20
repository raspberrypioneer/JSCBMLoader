// Settings: Amend pins and device filters below as required

const ATN_CLOCK_DATA_RESET_PINS = "9|18|19|20";  //Arduino Pro Micro
//const ATN_CLOCK_DATA_RESET_PINS = "2|3|4|5";  //Arduino Uno
const SERIAL_DEVICE_FILTERS = [
	{ usbVendorId: 0x2341, usbProductId: 0x8036 },   //Arduino Pro Micro
	{ usbVendorId: 0x2341, usbProductId: 0x0001 },   //Arduino Uno
	{ usbVendorId: 0x2341, usbProductId: 0x0043 }    //Arduino Uno (another)
];

// End of settings

const BUFFER_SIZE = 256;
const MAX_BYTES_PER_REQUEST = 254;

const HANDSHAKE_READY = "<CON>\r";
const HANDSHAKE_SEND = "<AOK>";
const HANDSHAKE_OK = "<END>\r";

const OPEN_CMD = 79;  //'O'
const READ_CMD = 82;  //'R'
const CLOSE_CMD = 67;  //'C'
const DIR_CMD = 76;  //'L'
const WRITE_FULL_CMD = 87; //'W'
const WRITE_PART_CMD = 119; //'w'
const DEBUG_CMD = 68;  //'D'

const OPEN_FNF = 88;  //'X'

const BUF_NORMAL = 66;  //'B'
const BUF_END = 98;  //'b'

const DIR_NORMAL = 76;  //'L'
const DIR_END = 108;  //'l'

const REVERSE_CHAR = 18;  //Commodore reverse text colour code
const SPACE_CHAR = 32;  //' '
const QUOTE_CHAR = 34;  //'"'
const NON_SPACE_CHAR = 160;  //' '

const FILE_TYPES = [[68, 69, 76],[83, 69, 81],[80, 82, 71],[85, 83, 82],[82, 69, 76]];  //"DEL", "SEQ", "PRG", "USR", "REL"

class jsCBMLoader {
	constructor(baudRate) {

		if (!navigator.serial) {
			alert("WebSerial is not enabled in this browser");
			return false;
		}

		this.baud = baudRate;

		//Setup event listener if caller passes in a message and handler
		this.on = (message, handler) => {
			parent.addEventListener(message, handler);
		};

		//Setup serial connect, disconnect event handlers
		navigator.serial.addEventListener("connect", this.serialConnect);
		navigator.serial.addEventListener("disconnect", this.serialDisconnect);
	}

	//Open serial port using Arduino filters
	async openPort() {

		try {
			this.port = await navigator.serial.requestPort({ SERIAL_DEVICE_FILTERS });  //Open pop-up selection window showing available ports
			await this.port.open({ baudRate: this.baud, BUFFER_SIZE });
			this.serialReadPromise = this.receiveArduino().catch(err => {
				console.error("Error on serial port:", err);
			});
			parent.dispatchEvent(new CustomEvent('data', { detail: { code: "SERCON", msg: "Serial device connected"} }));

		} catch (err) {
			console.error("Error opening serial port:", err);
			parent.dispatchEvent(new CustomEvent('data', { detail: { code: "SERERR", msg: "Error opening serial port"} }));
		}

	}  //openPort

	//Close serial port
	async closePort() {

		if (this.port) {
			this.reader.cancel();  //Stop the reader
			await this.serialReadPromise;  //Wait for the receiveArduino function to stop
			await this.port.close();
			this.port = null;
			parent.dispatchEvent(new CustomEvent('data', { detail: { code: "SERDIS", msg: "Serial device disconnected"} }));
		}

	}  //closePort

	//Assign program to load
	async setDriverForFile(file, testMode) {

		const extension = file.name.split('.').pop().toUpperCase();
		switch(extension) {
			case "D64":
				this.driver = new d64driver(file);
				await this.driver.readBinaryFile();
				await this.driver.buildDirectory();
				break;

			case "PRG":
				this.driver = new prgdriver(file);
				await this.driver.readBinaryFile();
				break;

			case "T64":
				this.driver = new t64driver(file);
				await this.driver.readBinaryFile();
				await this.driver.buildDirectory();
				break;
			
			default:
				parent.dispatchEvent(new CustomEvent('data', { detail: { code: "DRVUNS", msg: "No driver found for selected program"} }));
		}

		//Update load progress
		parent.dispatchEvent(new CustomEvent('progress', { detail: { progress: "0%"} }));

		//Return directory listing
		if (this.driver) {
			let htmlDirList = "";
			do {
				let { protocol, payload } = await this.driver.getDirectoryLine();
				const fileBlocks = payload[0] | payload[1] << 8;
				htmlDirList += String(fileBlocks) + " " + (String.fromCharCode(...payload.slice(2))).replace(String.fromCharCode(REVERSE_CHAR),"").replace(/[^A-Z0-9 !"#%&'()+-/@*[\]:;=<>,.?]/g, "-") + "<br/>";
				if (testMode) {
					console.log(payload);
				}
				if (protocol[0] != DIR_NORMAL) {
					break;
				}
			} while (true);
			parent.dispatchEvent(new CustomEvent('data', { detail: { code: "DIRLIST", msg: htmlDirList} }));
		}

		//In test mode, return program data payloads
		if (testMode && this.driver) {

			const delay = millis => new Promise((resolve, reject) => {
				setTimeout(_ => resolve(), millis);
			});

			const messagebuf = [42];  //* wildcard character
			if (await this.driver.openProgram(messagebuf)) {
				this.programSize = this.driver.subProgSize;
				this.bytesReceived = 0;
				do {
					let { protocol, payload } = await this.driver.getBuffer();

					this.bytesReceived += protocol[1];
					var progress = Math.ceil((this.bytesReceived / this.programSize) * 100);
					parent.dispatchEvent(new CustomEvent('progress', { detail: { progress: progress } }));  //Update load progress
					console.log(`READ_CMD: Sent ${this.bytesReceived} of ${this.programSize} bytes`);

					if (testMode) {
						console.log(payload);
					}
					await delay(10);

					if (protocol[0] != BUF_NORMAL) {
						break;
					}
				} while (true);
			}
		}

	}  //setDriverForFile

	//Receive data from Arduino and perform actions based on the protocol indicators
	async receiveArduino() {

		let validArduinoConnection = false;
		let readbuf = new ArrayBuffer(BUFFER_SIZE);
		let messagebuf = new Array();
		let msg = 0;
		let channel = 0;
		let bufLen = 0;
		let ok = true;

		while (this.port.readable) {

			this.reader = this.port.readable.getReader({ mode: "byob" });  //Initialize reader, mode is bring-your-own-buffer

			const { value, done } = await this.reader.read(new Uint8Array(readbuf));  //Read serial buffer
			if (value) {
				readbuf = value.buffer;  //Reset the buffer
				messagebuf = messagebuf.concat(Array.from(value));  //append the reader data to the message buffer

				if (validArduinoConnection && this.driver) {

					//Process the instructions in the message buffer
					ok = true;
					while (messagebuf.length > 0 && ok) {

						//Check first byte for the action required
						switch (messagebuf[0]) {

							//Handle open command
							case OPEN_CMD:
								ok = false;  //Assume the open message is incomplete
								if (messagebuf.length > 1) {
									bufLen = messagebuf[1];
									if (messagebuf.length >= bufLen) {
										ok = true;  //Open message is complete, continue
										channel = messagebuf[2];
										msg = messagebuf.splice(0,3);  //remove the command, message length, channel used above
										msg = messagebuf.splice(0, bufLen-3);  //next are the open command bytes

										if (msg.length > 0) {

											//Check the channel is supported (open to read)
											if ([0,2,8].includes(channel)) {
		
												//Return first payload, either a directory line or buffer load of program bytes
												if (msg == 36) {  //$ directory character
													console.log("DIR_CMD: Start directory listing");
													await this.sendArduino(Uint8Array.from([DIR_CMD,0]));
												}
												else {
													console.log(`OPEN_CMD: Open file [${msg}]`);
													if (await this.driver.openProgram(msg)) {
														this.programSize = this.driver.subProgSize;
														this.bytesReceived = 0;

														var { protocol, payload } = await this.driver.getBuffer();  //Get program bytes payload
														await this.sendArduino(protocol).then(await this.sendArduino(payload));

														this.bytesReceived += protocol[1];
														var progress = Math.ceil((this.bytesReceived / this.programSize) * 100);
														parent.dispatchEvent(new CustomEvent('progress', { detail: { progress: progress } }));  //Update load progress
														console.log(`READ_CMD: Sent ${this.bytesReceived} of ${this.programSize} bytes`);
													}
													else {
														console.log(`OPEN_FNF: Error opening ${msg}`);
														await this.sendArduino(Uint8Array.from([OPEN_FNF,1]));
														messagebuf = [];  //Clear the message buffer
													}
												}

											}
											else {
												const cmdName = String.fromCharCode(...msg);
												if (channel == 1 || (channel == 15 && cmdName.substring(0, 2) == "S:")) {
													console.log(`Pseudo-supported channel [${channel}] with command [${msg}]`);
													await this.sendArduino(Uint8Array.from([WRITE_FULL_CMD]));  //Acknowlege write instruction
												}
												else {
													if (cmdName == "M-R\xc4\xe5\x04" || cmdName == "M-R\xc6\xe5\x04") {
														//M-R for the drive number, see dos1541 rom $25c6 ($e5c4 - $c000 + 2)
														await this.sendArduino(Uint8Array.from([BUF_END,2,52,177]));  //Bytes from $25c6. Used in Bruce Lee 2
													}
													else {
														console.log(`Unsupported channel [${channel}] with command [${msg}]`);
														parent.dispatchEvent(new CustomEvent('data', { detail: { code: "CHAUNS", msg: "Unsupported channel"} }));
														messagebuf = [];  //Clear the message buffer
													}
												}

											}
										}
										else {
											console.log(`Unsupported channel [${channel}] with command [${msg}]`);
											await this.sendArduino(Uint8Array.from([OPEN_FNF,1]));
											parent.dispatchEvent(new CustomEvent('data', { detail: { code: "CHAUNS", msg: "Unsupported channel"} }));
											messagebuf = [];  //Clear the message buffer
										}
									}
								}
								break;

							//Handle read buffer command
							case READ_CMD:
								msg = messagebuf.shift();  //remove the command

								//Return next payload
								var { protocol, payload } = await this.driver.getBuffer();
								await this.sendArduino(protocol).then(await this.sendArduino(payload));

								this.bytesReceived += protocol[1];
								var progress = Math.ceil((this.bytesReceived / this.programSize) * 100);
								parent.dispatchEvent(new CustomEvent('progress', { detail: { progress: progress } }));  //Update load progress
								console.log(`READ_CMD: Sent ${this.bytesReceived} of ${this.programSize} bytes`);
								break;

							//Log close command
							case CLOSE_CMD:
								msg = messagebuf.shift();  //remove the command
								console.log("CLOSE_CMD: Closed file");
								break;

							//Handle directory listing command
							case DIR_CMD:
								msg = messagebuf.shift();  //remove the command

								//Return directory line
								var { protocol, payload } = await this.driver.getDirectoryLine();
								if (payload) {
									await this.sendArduino(protocol).then(await this.sendArduino(payload));
								}
								else {
									await this.sendArduino(protocol);
								}
								console.log(`DIR_CMD: Line ${payload}`);
								break;

							case WRITE_FULL_CMD:
							case WRITE_PART_CMD:
								ok = false;  //Assume the write message is incomplete
								if (messagebuf.length > 1) {
									bufLen = messagebuf[1];
									if (messagebuf.length >= bufLen) {
										console.log(`WRITE_CMD: Received ${bufLen} bytes`);
										ok = true;  //Write message is complete, continue
										msg = messagebuf.splice(0, bufLen);  //ignore write/save data
									}
								}
								break;

							//Debug instruction ('D' with a CR means debug message to process)
							case DEBUG_CMD:
								ok = false;  //Assume the debug message is incomplete
								let debugMsg = String.fromCharCode(...messagebuf);
								let cr_index = debugMsg.indexOf("\r\n");
								if (cr_index > 0) {
									ok = true;  //Debug message is complete, continue
									msg = messagebuf.splice(0, cr_index+2);  //remove the message including the CR/LF on the end
									console.log(`DEBUG_CMD: ${debugMsg.substring(0,cr_index)}`);
								}
								break;

							//Disgard any other messages
							default:
								msg = messagebuf.shift();  //remove the command
								console.log(`Disgarded message: ${msg}`);
							}
					}  //while

				}
				else {
					//Do the connection handshake
					let handshake = String.fromCharCode(...messagebuf);
					if (handshake.includes(HANDSHAKE_READY)) {
						console.log("Connecting to Arduino");
						parent.dispatchEvent(new CustomEvent('data', { detail: { code: "ARDWIP", msg: "Connecting to Arduino"} }));

						await this.sendArduino(new TextEncoder().encode(HANDSHAKE_SEND + "0|8|" + ATN_CLOCK_DATA_RESET_PINS + "\r"));
						messagebuf = [];  //Clear the message buffer, ready for next stage
					}
					else if (handshake.includes(HANDSHAKE_OK)) {
						console.log("Connected to Arduino");
						parent.dispatchEvent(new CustomEvent('data', { detail: { code: "ARDCON", msg: "Connected to Arduino"} }));

						validArduinoConnection = true;
						messagebuf = [];  //Clear the message buffer, ready for next stage
					}
				}

			}
			this.reader.releaseLock();
			if (done) {
				console.log("DONE!");
				break;
			}

		}  //while

	}  //receiveArduino

	//Write data to Arduino
	async sendArduino(data) {

		if (this.port.writable) {
			const writer = this.port.writable.getWriter();  //Initialize the writer
			await writer.write(data).then(writer.releaseLock());  //Send data and release the writer
		}

	} //sendArduino

	//Event handler for each time a new serial device connects
	serialConnect(event) {
		console.log(event.target);
	}

	//Event handler for each time a new serial device disconnects
	serialDisconnect(event) {
		console.log(event.target);
		parent.dispatchEvent(new CustomEvent('data', { detail: { code: "SERDIS", msg: "Serial device disconnected"} }));
	}

}