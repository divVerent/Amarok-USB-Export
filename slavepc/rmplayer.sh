#!/bin/sh

E_BOLD="[1m"
E_NORM="[m"

unmap()
{
	while IFS= read -r OUT && IFS= read -r IN; do
		if [ x"${IN##*/}" = x"${1##*/}" ]; then
			echo "$OUT"
			return 0
		fi
	done < filemap
	return 1
}

oldrating()
{
	case "$1" in
		*' - ('*')'*)
			OLDRATING=${1#*' - ('}
			OLDRATING=${OLDRATING%%')'*}
			echo "$OLDRATING"
			;;
	esac
}

newrating()
{
	NEWRATING=asis
	if [ -f ratings.txt ]; then
		while IFS= read -r L && IFS= read -r R; do
			if [ x"$L" = x"$1" ]; then
				NEWRATING=$R
			fi
		done < ratings.txt
	fi
	echo "$NEWRATING"
}

currating()
{
	case "$2" in
		asis)
			echo "$1"
			;;
		*)
			echo "$2"
			;;
	esac
}

unrated=
if [ -n "$UNRATED" ]; then
	echo "Removing rated files"
	first=true
	unrated=0
	for f in "$@"; do
		if $first; then
			first=false
			set --
		fi
		if [ -f "$f" ]; then
			oldrating=`oldrating "${f%.*}"`
			if [ -n "$oldrating" ] && [ x"$oldrating" != x"unrated" ]; then
				continue
			fi
			curfile=`unmap "${f%.*}"`
			if [ -n "$curfile" ]; then
				newrating=`newrating "$curfile"`
				currating=`currating "$oldrating" "$newrating"`
				if [ x"$currating" != x"unrated" ]; then
					continue
				fi
			fi
			unrated=$(($unrated+1))
		fi
		set -- "$@" "$f"
	done
	echo "done. $unrated files left."
fi

printinfo()
{
	f=$1
	curfile=`unmap "${f%.*}"`
	oldrating=`oldrating "${f%.*}"`
	newrating=`newrating "$curfile"`
	currating=`currating "$oldrating" "$newrating"`
	echo >&2
	echo >&2 "$E_BOLD""$curfile""$E_NORM"
	echo >&2 "$E_BOLD""Rating: $oldrating -> $newrating""$E_NORM"
	if [ -n "$unrated" ]; then
		echo >&2 "$E_BOLD""$unrated files left unrated""$E_NORM"
	fi
	echo >&2
}

mplayer \
	-quiet \
	-input conf="$HOME/rmplayer/input.conf" \
	"$@" \
	2>&1 | \
while IFS= read -r L; do
	case "$L" in
		"Playing "*".")
			f=${L##Playing }
			f=${f%.}
			printinfo "$f"
			;;
		"D0_RATING="*)
			r=${L#D0_RATING=}
			rp=$r
			found=false
			if [ -n "$unrated" ]; then
				if [ x"$currating" = x"unrated" ]; then
					unrated=$(($unrated-1))
				fi
			fi
			while [ -n "$rp" ]; do
				case "$rp" in
					*,*)
						rr=${rp%%,*}
						rp=${rp#*,}
						;;
					*)
						rr=$rp
						rp=
						;;
				esac
				if [ -z "$currating" ]; then
					found=true
					currating=$rr
				elif [ x"$currating" = x"$rr" ]; then
					found=true
					currating=
				fi
			done
			if [ -z "$currating" ] || ! $found; then
				currating=${r%%,*}
			fi
			if [ -n "$unrated" ]; then
				if [ x"$currating" = x"unrated" ]; then
					unrated=$(($unrated+1))
				fi
			fi
			echo >>ratings.txt "$curfile"
			echo >>ratings.txt "$currating"
			printinfo "$f"
			cp ratings.txt ~/
			;;
		*)
			echo >&2 "$L"
			;;
	esac
done
