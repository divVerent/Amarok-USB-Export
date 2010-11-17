#!/usr/bin/perl
use strict;
use warnings;
use Digest::MD5;
#use Archive::Zip;
use File::Temp qw/tempfile/;
use locale;
use Encode;
use Digest::MD5;
use POSIX qw/:sys_wait_h/;

my $playlist = shift @ARGV; # playlist
my $temp = shift @ARGV; # temp path
my $cache = shift @ARGV; # cache location
my $base = shift @ARGV; # relative base
my $thrbitrate = shift @ARGV; # bitrate threshold
my $lamesettings = shift @ARGV; # any LAME options
my $devicedir = shift @ARGV; # dir to rsync to
my $no_id3 = shift @ARGV;
my $use_subdirs = shift @ARGV;

print STDERR "clearing target directory...\n";
system qw/rm -rf/, $temp
	and die "rm: $?";
mkdir $temp
	or die "mkdir: $@";

print STDERR "making cache...\n";
mkdir $cache; # IGNORE

sub Cleanup($)
{
	my ($fn) = @_;
	$fn =~ s{[^[:alnum:]_ .()-]}{_}g;
	$fn =~ s/^(.{59}).*$/$1/;
	# (rating) at start of file name
	# 59: 63 minus ".mp3"
	$fn =~ s/^ *//;
	$fn =~ s/ *$//;
	$fn = lc $fn;
	return $fn;
}

sub iso($)
{
	my ($n) = @_;
	return $n if not defined $n;
	my $iso = Encode::encode("iso-8859-1", "$n", Encode::FB_DEFAULT);
	return $iso;
}

sub TagMP3($$$)
{
        my ($origname, $filename, $tagname) = @_;

	local $ENV{mp3_file} = $filename;
	system 'id3v2 -D "$mp3_file"';
	if($no_id3)
	{
		return;
	}

	my $title = $tagname;
	my $artist = "???";
	my $rating = "???";
	$title =~ s/(.*) - //
		and $artist = $1;
	$title =~ s/^\(([^)]+)\) //
		and $rating = $1;

	local $ENV{mp3_title} = iso $title;
	local $ENV{mp3_artist} = iso $artist;
	local $ENV{mp3_rating} = iso $rating;
	system 'id3v2 -a "$mp3_artist" -A "$mp3_album" -t "($mp3_rating) $mp3_title" "$mp3_file"';
}

sub CacheFile($$$$)
{
	my ($file, $cachename, $tagname, $length) = @_;
	my $infile = "$base/$file";
	my $cachefile = "$cache/$cachename";

	if(-e $cachefile)
	{
		my $readfh;
		open $readfh, "<", $cachefile
			and read $readfh, my $var, 1
				or warn "open/read $cachefile: $!";
		return $cachefile, "mp3";
	}

	local $ENV{infile} = $infile;
	local $ENV{outfile} = $cachefile;

	my $bitrate = (-s "$infile") / (128 * $length);
	if($file =~ /\.ogg$/)
	{
		print "Always re-encoding OGG files.\n";
		#system 'oggdec -o - "$infile" | lame ' . $lamesettings . ' - "$outfile^" && mv "$outfile^" "$outfile"'
		system 'ogg123 -d wav -f - "$infile" | lame ' . $lamesettings . ' - "$outfile^" && mv "$outfile^" "$outfile"'
			and die "lame/oggdec: $?";
	}
	elsif($file =~ /\.flac$/)
	{
		print "Always re-encoding FLAC files.\n";
		system 'flac -d -o - "$infile" | lame ' . $lamesettings . ' - "$outfile^" && mv "$outfile^" "$outfile"'
			and die "lame/flac: $?";
	}
	elsif($file =~ /\.mp3$/)
	{
		if(not defined $bitrate or $bitrate >= $thrbitrate)
		{
			print "Bitrate is $bitrate (threshold: $thrbitrate), re-encoding.\n";
			system 'madplay --display-time=remaining -v -o wav:- --amplify=-2.5 "$infile" | lame ' . $lamesettings . ' - "$outfile^" && mv "$outfile^" "$outfile"'
				and die "lame: $?";
		}
		else
		{
			print "Bitrate is only $bitrate (threshold: $thrbitrate), not re-encoding!\n";
			system 'cp -v "$infile" "$outfile"'
				and die "ln: $?";
		}
	}
	else # if($file =~ /\.m4a$|\.mpc$/)
	{
		print "Always re-encoding other files.\n";
		system 'mplayer -ao pcm "$infile" && lame ' . $lamesettings . ' audiodump.wav "$outfile^" && rm audiodump.wav && mv "$outfile^" "$outfile"'
			and die "lame/mplayer: $?";
	}

	system 'mp3gain -r -s r -d 999 -k "$outfile"';
	TagMP3($file => $cachefile, $tagname);

	return $cachefile, "mp3";
}

sub ConvertFile($$$$$)
{
	my ($src, $dest, $cachename, $tagname, $length) = @_;
	print STDERR "$_[1]\e[K\n";
	my ($cachefile, $ext) = CacheFile $src, $cachename, $tagname, $length;
	$dest .= ".$ext";
	symlink $cachefile, $dest
		or die "symlink $cache $dest: $!";
	return 1;
}

my $njobs = 4;
my @jobs = ();
my $joberror = 0;
sub waitjob($)
{
	my ($flag) = @_;
	my $pid = waitpid -1, $flag;
	return 0
		if $pid < 0;
	if($?)
	{
		print STDERR "Job $pid exited with an error\n";
		++$joberror;
	}
	@jobs = grep { $_ != $pid } @jobs;
	return 1;
}
sub job(&)
{
	my ($sub) = @_;
	waitjob 0
		while @jobs >= $njobs;
	defined(my $pid = fork())
		or die "fork: $!";
	if($pid == 0)
	{
		# child
		my $ret = $sub->();
		die "Job failed"
			unless $ret;
		exit 0;
	}
	push @jobs, $pid;
}

print STDERR "reading the playlist...\n";
open my $pfh, "<", $playlist
	or die "<$playlist: $!";
binmode $pfh, ":utf8";

open my $infofile, ">", "$temp/filemap"
	or die ">$temp/filemap: $!";
binmode $infofile, ":utf8";

binmode STDERR, ":utf8";
binmode STDOUT, ":utf8";

print STDERR "compacting and generating...\n";
my $extname = undef;
my $extlength = undef;
while(<$pfh>)
{
	chomp;
	next if /^#EXTM3U$/;
	if(/^#EXTINF:(\d+),(.*)/)
	{
		$extlength = $1;
		$extname = $2;
		next;
	}
	my $infile = $_;
	$extname = ($infile =~ m!([^/]*)\.[^./]*$!)
		if not defined $extname or $extname eq "";
	$extlength = 3*60
		if not defined $extlength or $extlength == 0;
	my $outfile = Cleanup $extname;
	my $prefix = ".";
	if($use_subdirs)
	{
		$prefix = substr $outfile, 0, 1;
		mkdir "$temp/$prefix";
	}
	my $infile_bytes = "$infile//$extname";
	utf8::encode($infile_bytes);
	my $cachefile = Digest::MD5::md5_hex($infile_bytes);
	print $infofile "$_\n$prefix/$outfile\n";
	job
	{
		ConvertFile $infile, "$temp/$prefix/$outfile", $cachefile, $outfile, $extlength;
	};
	undef $extname;
	undef $extlength;
}

# wait for all jobs
1 while waitjob 0;

close $infofile;

print STDERR "done. Syncing...\n";

system 'rsync',
	'-vrtWLP', '--size-only', '--inplace', '--delete-before', 
	"$temp/", "$devicedir/";
