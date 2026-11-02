#!/usr/bin/env bash

set -euo pipefail

RE_REPLACE='[vV][sS][cC][oO][dD][iI][uU][mM]|[vV][sS][cC][oO][dD][eE]|[cC][oO][dD][iI][uU][mM]'
RE_FIND='*vscode*'

dry_run=no
root=.

usage () {
  echo "uso: ${0##*/} [-n|--dry-run] [directorio]"
}

while [[ $# -gt 0 ]]; do
  case "${1}" in
    -n|--dry-run|--dryrun)
      dry_run=yes
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "opción desconocida: ${1}" >&2
      usage >&2
      exit 1
      ;;
    *)
      root="${1}"
      shift
      ;;
  esac
done

if [[ ! -d "${root}" ]]; then
  echo "no existe el directorio: ${root}" >&2
  exit 1
fi

shopt -s nullglob

to_gencode () {
  local word="${1}"
  local tail="${1:1}"

  if [[ "${word}" == "${word,,}" ]]; then
    printf 'gencode'
  elif [[ "${word}" == "${word^^}" ]]; then
    printf 'GENCODE'
  elif [[ "${tail}" == "${tail,,}" ]]; then
    printf 'Gencode'
  else
    printf 'GenCode'
  fi
}

replace_name () {
  local name="${1}"
  local out="" rest="${name}" match prefix

  while [[ "${rest}" =~ ${RE_REPLACE} ]]; do
    match="${BASH_REMATCH[0]}"
    prefix="${rest%%"${match}"*}"
    out+="${prefix}$( to_gencode "${match}" )"
    rest="${rest:$(( ${#prefix} + ${#match} ))}"
  done

  printf '%s%s' "${out}" "${rest}"
}

matches () {
  local name="${1}"
  [[ "${name,,}" == *vscode* || "${name,,}" == *vscodium* || "${name,,}" == *codium* ]]
}

count=0
skipped=0

while IFS= read -r -d '' path; do
  dir="${path%/*}"
  base="${path##*/}"

  [[ -z "${dir}" ]] && dir="/"

  if [[ "${path}" == */.git || "${path}" == */.git/* ]]; then
    skipped=$(( skipped + 1 ))
    continue
  fi

  matches "${base}" || continue

  new_base="$( replace_name "${base}" )"
  [[ "${new_base}" == "${base}" ]] && continue

  if [[ -e "${dir}/${new_base}" || -L "${dir}/${new_base}" ]]; then
    echo "omitido (ya existe): ${dir}/${new_base}" >&2
    skipped=$(( skipped + 1 ))
    continue
  fi

  if [[ "${dry_run}" == "yes" ]]; then
    echo "${path} -> ${new_base}"
  else
    mv -- "${path}" "${dir}/${new_base}"
    echo "${path} -> ${new_base}"
  fi

  count=$(( count + 1 ))
done < <( find "${root}" -depth \( -iname '*vscode*' -o -iname '*vscodium*' -o -iname '*codium*' \) -print0 )

echo "renombrados: ${count}  omitidos: ${skipped}"
