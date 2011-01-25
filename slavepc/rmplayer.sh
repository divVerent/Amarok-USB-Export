#!/bin/sh

unmap()
{
	while IFS= read -r OUT; do
		read -r IN
		if [ x"${IN##*/}" = x"${1##*/}" ]; then
			echo "$OUT"
			return 0
		fi
	done < filemap
	return 1
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
			curfile=`unmap "${f%.*}"`
			currating=
			echo >&2 "$L"
			echo >&2 "(on grawp: $curfile)"
			;;
		"D0_RATING="*)
			r=${L#D0_RATING=}
			rp=$r
			found=false
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
			echo
			echo "RATING FOR $curfile: $currating"
			echo
			echo >>ratings.txt "$curfile"
			echo >>ratings.txt "$currating"
			;;
		*)
			echo >&2 "$L"
			;;
	esac
done
