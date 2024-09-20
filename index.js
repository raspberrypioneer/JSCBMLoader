const DEFAULT_BAUD_RATE = 115200;
const DEFAULT_RETRO = "c64";  //Used for logo and artwork images
const ALTERNATE_RETRO = "vic20";  //Used for logo and artwork images
const PROGRAM_SEARCH_URL = "https://www.google.com/search?q=";  //Used on image artwork click
const $ = id => document.getElementById(id);

//Setup the main elements and invoke objLoader from class
function setup() {

	const urlParams = new URLSearchParams(window.location.search);
	const testMode = urlParams.get('testMode') ? true : false;

	//Set default retro from local storage value
	let selectedRetro = localStorage.getItem("selectedRetro");
	if (!selectedRetro) {
		selectedRetro = DEFAULT_RETRO;
		localStorage.setItem("selectedRetro", selectedRetro);
	}

	const objLoader = new jsCBMLoader(DEFAULT_BAUD_RATE);
	if (objLoader) {
		objLoader.on("data", receiveData);
		objLoader.on("progress", updateProgressBar);
	}

	$("imgConnect").onclick = function() {
		if (objLoader) {
			if (objLoader.port) {
				objLoader.closePort();
			}
			else {
				objLoader.openPort();
			}
		}
	};

	$("imgFileSelect").onclick = function() {
		$("fileInput").click();
	};
	$("fileInput").oninput = function() {

		$("selProgList").length = 0;
		$("imgFileSelect").src = "./resources/files-empty.png";
		$("divReceivedMsg").innerHTML = "";
		$("divDirectory").style.display = "none";
		$("divDirectory").innerHTML = "";
		$("imgArt").style.display = "none";
		$("imgArt").classList.remove("fade");
		$("imgArt").classList.add("show");
		$("divProgressBar").style.display = "none";
		$("divTitle").innerText = "";
		$("divInfo").innerHTML = "";

		const file = $("fileInput").files[0];
		if (!file) {
			return;
		}

		//Populate program selection list
		for (let i = 0; i < $("fileInput").files.length; i++) {
			$("selProgList").add(new Option($("fileInput").files[i].name));
		}

		//Change icon to indicated selected
		if ($("selProgList").length > 0) {
			$("imgFileSelect").src = "./resources/files-available.png";
		}
		else {
			$("imgFileSelect").src = "./resources/files-empty.png";
		}

		//Only one item in the list, select it
		if ($("selProgList").length == 1) {
			if (objLoader) {
				objLoader.setDriverForFile($("fileInput").files[0], testMode)
				.catch(err => {
					console.error(`Error reading file:`, err);
				});
			}
			$("selProgList")[0].selected = true;
			setImageArt(selectedRetro);
		}
	};

	$("selProgList").onchange = function() {
		//console.log(`${$("selProgList").selectedIndex} ${$("selProgList").value}`);
		//console.log($("fileInput").files[$("selProgList").selectedIndex]);
		if (objLoader) {
			objLoader.setDriverForFile($("fileInput").files[$("selProgList").selectedIndex], testMode)
			.catch(err => {
				console.error(`Error reading file:`, err);
			});
			setImageArt(selectedRetro);
		}
	};

	//Assign the default logo and allow it to be changed
	$("imgLogo").src = `./resources/logo_${selectedRetro}.png`;
	$("imgLogo").onclick = function() {
		selectedRetro = (selectedRetro == DEFAULT_RETRO ? ALTERNATE_RETRO : DEFAULT_RETRO);
		localStorage.setItem("selectedRetro", selectedRetro);
		$("imgLogo").src = `./resources/logo_${selectedRetro}.png`;
	};

	//Set the image art display attributes when found / not found
	$("imgArt").onerror = function() {
		this.style.display = "none";
		$("imgArt").classList.add("fade");
		$("imgArt").classList.remove("show");
		$("divDirectory").style.display = "";
	};
	$("imgArt").onload = function() {
		this.style.display = "";
		this.title = $("selProgList").value.split(".")[0];
	};

	//Toggle display of directory listing on top of image art
	$("imgArt").onclick = function() {
		toggleDir();
	};
	$("divDirectory").onclick = function() {
		toggleDir();
	};

	//Navigate to search URL for selected program
	$("imgWeb").onclick = function() {
		if ($("selProgList").selectedIndex > -1) {
			window.open(`${PROGRAM_SEARCH_URL}Commodore ${selectedRetro} ${$("imgArt").alt}`, '_blank').focus();
		}
	};

}

//Set image art for selected program file
function setImageArt(selectedRetro) {
	const itemName = $("selProgList").value.split(".")[0];
	$("imgArt").src = `./resources/art/${selectedRetro}/${itemName}-image.jpg`;
	$("imgArt").alt = itemName;
	$("divProgressBar").style.display = "";
	$("divProgress").style.width = "0%";
	$("divTitle").innerText = itemName;
	$("divInfo").innerHTML = `<p>${(selectedRetro == DEFAULT_RETRO ? info_c64 : info_vic20)[$("selProgList").value]||""}</p>`;
}

//Toggle show image or program directory
function toggleDir() {
	if ($("divDirectory").style.display == "none") {
		$("imgArt").classList.add("fade");
		$("imgArt").classList.remove("show");
		$("divDirectory").style.display = "";
	}
	else {
		$("divDirectory").style.display = "none";
		$("imgArt").classList.remove("fade");
		$("imgArt").classList.add("show");
	}
}

//Update the received message span with Serial data received
function receiveData(event) {

	switch (event.detail.code) {
		case "SERCON":
			$("imgConnect").src = "./resources/usb-connected.png";
			break;
		case "SERDIS":
			$("imgConnect").src = "./resources/usb-disconnected.png";
			break;
		case "ARDCON":
			$("imgConnect").src = "./resources/usb-handshake-ok.png";
			break;
	}
	if (event.detail.code == "DIRLIST") {
		$("divDirectory").innerHTML = `<pre class="pre-fixed-class">${event.detail.msg}</pre>`;
	}
	else {
		$("divReceivedMsg").innerHTML = `<p>${event.detail.msg}</p>`;
	}

}

function updateProgressBar(event) {
	$("divProgress").style.width = `${event.detail.progress}%`;
}

//Run the setup function when the page is loaded
document.addEventListener("DOMContentLoaded", setup);
