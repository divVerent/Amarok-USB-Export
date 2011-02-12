Importer.loadQtBinding( "qt.core" );
Importer.loadQtBinding( "qt.gui" );

var configFileName = Amarok.Info.scriptPath() + "/usbexport.conf";

USBExportMainWindow.prototype = new QMainWindow();

USBExportMainWindow.prototype.executeSave = function(e)
{
	Amarok.debug("Saving");
	var s = new QSettings(configFileName, QSettings.NativeFormat);
	s.setValue("main/OutputID3", (this.outputID3CheckBox.checked ? "yes" : "no"));
	s.setValue("main/OutputTemp", this.outputTempLineEdit.text);
	s.setValue("main/OutputCache", this.outputCacheLineEdit.text);
	s.setValue("main/OutputDeviceDir", this.outputDeviceDirLineEdit.text);
	s.setValue("main/OutputSubdirs", (this.outputSubdirsCheckBox.checked ? "yes" : "no"));
	s.setValue("main/TotalDuration", this.totalDurationSpinBox.value);
	s.setValue("main/Unrated", this.unratedSpinBox.value);
	// selection:
	//   first, rating10 tracks >= 10
	//   then, rating9 tracks >= 9
	//   then, rating8 tracks >= 8
	//   ...
	//   values are percentages of remaining count
	for(var i = 0; i < 10; ++i)
		s.setValue("main/Rating" + i, this.ratingSpinBox[i].value);
	Amarok.debug("Saved");
}

USBExportMainWindow.prototype.getListForExport = function(field)
{
	var totalTimeRemaining = this.totalDurationSpinBox.value * 60 * 60 * 1000; // hours to millseconds
	var finished = false;
	var list = [];
	var dupeskip = new Object();
	var timeRemaining = 0;
	OUTER:
	for(var i = 10; !finished && i >= -1; --i)
	{
		var timeChunk;
		if(i >= 10)
			timeChunk = totalTimeRemaining * this.unratedSpinBox.value / 100.0;
		else if(i >= 0)
			timeChunk = totalTimeRemaining * this.ratingSpinBox[i].value / 100.0;
		else
			timeChunk = totalTimeRemaining;
		timeRemaining += timeChunk;
		totalTimeRemaining -= timeChunk;
		
		if(timeRemaining <= 0)
			continue;

		var maxRemaining = Math.ceil(timeRemaining / 30000); // 30 sec per track min

		var sql;
		if(i >= 10)
			sql = "SELECT d.lastmountpoint, u.rpath, t.length, s.rating, a.name, t.title FROM tracks t LEFT JOIN statistics s ON s.url = t.url LEFT JOIN artists a ON a.id = t.artist INNER JOIN urls u on u.id = t.url LEFT JOIN devices d ON d.id = u.deviceid WHERE s.rating IS NULL ORDER BY RAND() LIMIT " + Amarok.Collection.escape(maxRemaining) + ";";
		else if(i >= 0)
			sql = "SELECT d.lastmountpoint, u.rpath, t.length, s.rating, a.name, t.title FROM tracks t LEFT JOIN statistics s ON s.url = t.url LEFT JOIN artists a ON a.id = t.artist INNER JOIN urls u on u.id = t.url LEFT JOIN devices d ON d.id = u.deviceid WHERE s.rating > " + Amarok.Collection.escape(i) + " ORDER BY RAND() LIMIT " + Amarok.Collection.escape(maxRemaining) + ";";
		else
			sql = "SELECT d.lastmountpoint, u.rpath, t.length, s.rating, a.name, t.title FROM tracks t LEFT JOIN statistics s ON s.url = t.url LEFT JOIN artists a ON a.id = t.artist INNER JOIN urls u on u.id = t.url LEFT JOIN devices d ON d.id = u.deviceid ORDER BY RAND() LIMIT " + Amarok.Collection.escape(maxRemaining) + ";";
		//Amarok.debug(sql);
		var result = Amarok.Collection.query(sql);
		//Amarok.debug(result.length);
		for(var j = 0; j < result.length; j += 6)
		{
			var mountpoint = result[j];
			var path = result[j+1];
			var len = result[j+2];
			var rating = result[j+3];
			var artist = result[j+4];
			var title = result[j+5];
			if(mountpoint == null)
				path = "/" + path;
			else
				path = mountpoint + "/" + path;
			if(artist == null || artist == "")
				artists = "???";
			if(title == null || title == "")
			{
				title = "" + path;
				title = title.replace(/^.*\//, "");
				title = title.replace(/\.[^.]*$/, "");
			}
			if(rating != null && rating != "")
				rating = parseInt(rating);
			else
				rating = null;
			if(dupeskip[artist + " - " + title])
				continue;
			dupeskip[artist + " - " + title] = true;
			if(len > totalTimeRemaining + timeRemaining)
			{
				// if we exceeded the TOTAL time, bail out
				// so we won't prefer the tiny tracks next round
				break OUTER;
			}
			if(len > timeRemaining)
				break;
			timeRemaining -= len;
			list.push({ path: path, len: len, rating: rating, artist: artist, title: title, rand: Math.random()});
		}
	}

	function compareItem(a, b)
	{
		if(a[0] < b[0])
			return -1;
		if(a[0] < b[0])
			return 1;
		return 0;
	}

	/*
	var counter = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
	var total = 0;
	for(var i = 0; i < list.length; ++i)
	{
		//Amarok.debug(list[i][0] + " | " + list[i][2]);
		if(list[i][2] == null)
			counter[0] += 1;
		else
			counter[list[i][2]+1] += 1;
		++total;
	}
	Amarok.debug("Not rated: " + counter[0]*1.0/total);
	for(var i = 1; i < 12; ++i)
	{
		Amarok.debug("Rating == " + (i-1)/2 + " stars: " + counter[i]*1.0/total);
	}
	*/

	if(field != null)
	{
		function compareItem(a, b)
		{
			if(a[field] < b[field])
				return -1;
			if(a[field] > b[field])
				return 1;
			return 0;
		}
		list.sort(compareItem);
	}

	return list;
}

USBExportMainWindow.prototype.executeExport = function()
{
	var list = this.getListForExport("path");

	try
	{
		var outdir = this.outputDeviceDirLineEdit.text;
		var f_ratings = new QFile(outdir + "/ratings.txt");
		f_ratings.open(new QIODevice.OpenMode(QIODevice.ReadOnly));
		if(f_ratings.isReadable())
		{
			var allRatings = new Object();
			var allRatingsKeys = [];
			try
			{
				var ratings = new QTextStream(f_ratings);
				for(;;)
				{
					var path = ratings.readLine();
					var rating = ratings.readLine();
					if(!rating)
						break;
					rating = Math.round(parseFloat(rating) * 2);
					if(allRatings[path] == null)
						allRatingsKeys.push(path);
					allRatings[path] = rating;
				}
			}
			finally
			{
				f_ratings.close();
			}

			if(allRatingsKeys.length)
			{
				var str = "";
				allRatingsKeys.sort();
				for(var i = 0; i < allRatingsKeys.length; ++i)
					str += allRatingsKeys[i] + ": " + (allRatings[allRatingsKeys[i]] / 2.0) + "\n";
				str = "Update the following ratings?\n\n" + str;
				var result = (Amarok.alert(str, "questionYesNo") == 3); // yes == 3, no == 4
				if(result)
				{
					for(var e in allRatings)
					{
						var m = e.match(/^(.*?)\/\.\/(.*?)$/);
						if(!m)
							continue;
						var dev = m[1];
						var path = "./" + m[2];
						var sql = "INSERT INTO statistics SET url=(SELECT u.id FROM u.urls LEFT JOIN devices d ON d.id = u.deviceid WHERE u.rpath='" + Amarok.Collection.escape(path) + "' AND d.lastmountpoint = '" + Amarok.Collection.escape(dev) + "'), rating=" + allRatings[e] + " ON DUPLICATE KEY UPDATE rating=" + allRatings[e];
						Amarok.Collection.query(sql);
					}
					f_ratings.remove();
				}
			}
		}

		var tempdir = this.outputTempLineEdit.text;
		new QDir("/").mkpath(tempdir);

		var mp3dir = tempdir + "/mp3";
		new QDir("/").mkpath(mp3dir);

		var cachedir = this.outputCacheLineEdit.text + (this.outputID3CheckBox.checked ? "/id3" : "/plain");
		new QDir("/").mkpath(cachedir);

		var m3u = tempdir + "/index.m3u";

		var f = new QFile(m3u);
		f.open(new QIODevice.OpenMode(QIODevice.WriteOnly));
		if(f.isWritable())
		{
			try
			{
				var out = new QTextStream(f);
				out.writeString("#EXTM3U\n");
				for(var i = 0; i < list.length; ++i)
				{
					var ratingval;
					if(list[i].rating == null)
						ratingval = "unrated";
					else
						ratingval = (list[i].rating / 2);
					out.writeString(
						"#EXTINF:" + Math.floor(list[i].len/1000) + "," + list[i].artist + " - (" + ratingval + ") " + list[i].title + "\n" +
						list[i].path + "\n");
				}
				out.flush();
				f.flush();
			}
			finally
			{
				f.close();
			}

			// now run the converter
			QProcess.startDetached("xterm", [
				"-hold",
				"-e",
				Amarok.Info.scriptPath() + "/usbexport.pl",
				m3u,
				mp3dir,
				cachedir,
				"160",
				"compression_level=2,global_quality=3", // --vbr-new -V 3 -q 2
				outdir,
				(this.outputID3CheckBox.checked ? "0" : "1"),
				(this.outputSubdirsCheckBox.checked ? "1" : "0")
			]);

			// then rsync it to the USB device
		}
		else
			Amarok.debug("outfile " + m3u + " is not writable");
	}
	catch(e)
	{
		Amarok.debug("" + e);
	}

	this.close(true);
}

USBExportMainWindow.prototype.executeExportToPlaylist = function()
{
	var list = this.getListForExport("rand");

	try
	{
		Amarok.Playlist.clearPlaylist();
		for(var i = 0; i < list.length; ++i)
		{
			Amarok.debug(list[i].path);
				Amarok.Playlist.addMedia(new QUrl("file:///" + list[i].path));
		}
	}
	catch(e)
	{
		Amarok.debug("" + e);
	}
}

USBExportMainWindow.prototype.selectOutputTemp = function()
{
	var out = QFileDialog.getExistingDirectory(null, "Select temporary directory (WILL GET DELETED)", this.outputTempLineEdit.text);
	if(out != "")
		this.outputTempLineEdit.text = out;
}

USBExportMainWindow.prototype.selectOutputCache = function()
{
	var out = QFileDialog.getExistingDirectory(null, "Select cache directory", this.outputCacheLineEdit.text);
	if(out != "")
		this.outputCacheLineEdit.text = out;
}

USBExportMainWindow.prototype.selectOutputDeviceDir = function()
{
	var out = QFileDialog.getExistingDirectory(null, "Select output directory", this.outputDeviceDirLineEdit.text);
	if(out != "")
		this.outputDeviceDirLineEdit.text = out;
}

function USBExportMainWindow()
{
	Amarok.debug("open main window");
	QMainWindow.call(this, null);
	var s = new QSettings(configFileName, QSettings.NativeFormat);
	var mainWidget = new QWidget(this);

	this.exportButton = new QPushButton(mainWidget);
	this.exportButton.clicked.connect(this, this.executeExport);
	this.exportButton.text = "Export";

	this.saveButton = new QPushButton(mainWidget);
	this.saveButton.clicked.connect(this, this.executeSave);
	this.saveButton.text = "Save";

	this.exportToPlaylistButton = new QPushButton(mainWidget);
	this.exportToPlaylistButton.clicked.connect(this, this.executeExportToPlaylist);
	this.exportToPlaylistButton.text = "To Playlist";

	this.parametersBox = new QGroupBox("Settings", mainWidget);
	this.buttonsBox = new QWidget(mainWidget);

	//var layout = new QVBoxLayout(mainWidget);
	var layout = new QVBoxLayout();

	layout.addWidget(this.parametersBox, 0, 0);
	layout.addWidget(this.buttonsBox, 0, 0);

	//var buttonsLayout = new QHBoxLayout(mainWidget);
	var buttonsLayout = new QHBoxLayout();
	buttonsLayout.addWidget(this.exportButton, 0, 0);
	buttonsLayout.addWidget(this.saveButton, 0, 0);
	buttonsLayout.addWidget(this.exportToPlaylistButton, 0, 0);
	this.buttonsBox.setLayout(buttonsLayout);

	//var groupLayout = new QGridLayout(mainWidget);
	var groupLayout = new QGridLayout();
	var row = 0;

	this.outputTempLineEdit = new QLineEdit(this.parametersBox);
	this.outputTempLineEdit.text = s.value("main/OutputTemp", "/tmp/usbexport");
	var outputTempButton = new QPushButton("Temp directory...", this.parametersBox);
	outputTempButton.clicked.connect(this, this.selectOutputTemp);
	groupLayout.addWidget(outputTempButton, row, 0);
	groupLayout.addWidget(this.outputTempLineEdit, row, 1);
	++row;

	this.outputCacheLineEdit = new QLineEdit(this.parametersBox);
	this.outputCacheLineEdit.text = s.value("main/OutputCache", "/tmp2/CACHE/usbexport");
	var outputCacheButton = new QPushButton("Cache directory...", this.parametersBox);
	outputCacheButton.clicked.connect(this, this.selectOutputCache);
	groupLayout.addWidget(outputCacheButton, row, 0);
	groupLayout.addWidget(this.outputCacheLineEdit, row, 1);
	++row;

	this.outputDeviceDirLineEdit = new QLineEdit(this.parametersBox);
	this.outputDeviceDirLineEdit.text = s.value("main/OutputDeviceDir", "/media/sdb1/mp3");
	var outputDeviceDirButton = new QPushButton("Output directory...", this.parametersBox);
	outputDeviceDirButton.clicked.connect(this, this.selectOutputDeviceDir);
	groupLayout.addWidget(outputDeviceDirButton, row, 0);
	groupLayout.addWidget(this.outputDeviceDirLineEdit, row, 1);
	++row;

	this.outputID3CheckBox = new QCheckBox("Output ID3 tags", this.parametersBox);
	this.outputID3CheckBox.checked = (s.value("main/OutputID3", "yes") == "yes");
	groupLayout.addWidget(this.outputID3CheckBox, row, 0, 1, 2);
	++row;

	this.outputSubdirsCheckBox = new QCheckBox("Output subdirectories", this.parametersBox);
	this.outputSubdirsCheckBox.checked = (s.value("main/OutputSubdirs", "yes") == "yes");
	groupLayout.addWidget(this.outputSubdirsCheckBox, row, 0, 1, 2);
	++row;

	this.totalDurationSpinBox = new QSpinBox(this.parametersBox);
	this.totalDurationSpinBox.setRange(0, 168);
	this.totalDurationSpinBox.value = s.value("main/TotalDuration");
	var totalDurationLbl = new QLabel("Duration (h)", this.parametersBox);
	totalDurationLbl.setBuddy(this.totalDurationSpinBox);
	groupLayout.addWidget(totalDurationLbl, row, 0);
	groupLayout.addWidget(this.totalDurationSpinBox, row, 1);
	++row;

	this.unratedSpinBox = new QSpinBox(this.parametersBox);
	this.unratedSpinBox.setRange(0, 100);
	this.unratedSpinBox.value = s.value("main/Unrated");
	var unratedLbl = new QLabel("Unrated", this.parametersBox);
	unratedLbl.setBuddy(this.unratedSpinBox);
	groupLayout.addWidget(unratedLbl, row, 0);
	groupLayout.addWidget(this.unratedSpinBox, row, 1);
	++row;

	this.ratingSpinBox = [];
	for(var i = 9; i >= 0; --i)
	{
		this.ratingSpinBox[i] = new QSpinBox(this.parametersBox);
		this.ratingSpinBox[i].setRange(0, 100);
		this.ratingSpinBox[i].value = s.value("main/Rating" + i);
		var lbl = new QLabel("Rating >= " + (i+1)/2 + " stars", this.parametersBox);
		lbl.setBuddy(this.ratingSpinBox[i]);
		groupLayout.addWidget(lbl, row, 0);
		groupLayout.addWidget(this.ratingSpinBox[i], row, 1);
		++row;
	}
	this.parametersBox.setLayout(groupLayout);

	mainWidget.setLayout(layout);
	this.setCentralWidget(mainWidget);
	//this.resize(600, 400);
	this.show();
}

function USBExportCallback() {
	var mainWindow = new USBExportMainWindow();
}

if(Amarok.Window.addToolsMenu("script_usb_export", "USB Export..."))
{
	var sync_button = Amarok.Window.ToolsMenu.script_usb_export;
	sync_button['triggered()'].connect(USBExportCallback);
}
else
	Amarok.debug("USB Export menu already exists");

//USBExportCallback();
