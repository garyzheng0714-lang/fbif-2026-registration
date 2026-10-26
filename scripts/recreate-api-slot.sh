#!/usr/bin/env bash
# recreate-api-slot.sh — 换上中台文件里的新值：按原样重建一个 API 槽位容器，不切流量。
#
# 用法（root）：recreate-api-slot.sh <prod|staging> <blue|green>
#
# FBIF 中台的本机代理改写 /etc/fbif-hub/env/<项目名>.env 后执行它（本机配置里登记的重启命令）；
# 健康不过时代理写回上一版文件、再执行一次。部署 promote 时装到 <APP_DIR>/bin/recreate-api-slot.sh。
# 只动 <项目名>-api-<颜色> 这一个容器，nginx、active_slot、另一种颜色都不碰。
#
# 新容器 = 原容器的镜像 ID（生产和测试同一提交共用一个标签，按标签可能拿到另一套的镜像）
#        + 原容器的重启策略、init、CPU（不超过本机核数）、内存、网络、端口
#        + 原容器的环境去掉中台管的名字，再叠中台文件（排最后，同名以它为准）。
#          中台管的名字 = 现在中台文件里的 + 原容器标签 fbif-hub.env-names 记的（中台停用的名字也要去掉）。
# 端口固定，新旧不能同时起：先建好新容器，再停旧的、起新的；/health 不过就停新的、起回旧的，退出码非 0。
# 代理给重启命令 60 秒：停旧 ≤10 秒、等新 ≤18 秒、停新 ≤5 秒、等旧 ≤12 秒，最坏 50 秒出头。
set -euo pipefail

usage() {
  echo "用法: $0 <prod|staging> <blue|green>" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
case "$1" in
  prod) PROJECT=fbif-form; BLUE_PORT=8080; GREEN_PORT=18080 ;;
  staging) PROJECT=fbif-form-staging; BLUE_PORT=28080; GREEN_PORT=28081 ;;
  *) usage ;;
esac
case "$2" in
  blue) PORT="${BLUE_PORT}" ;;
  green) PORT="${GREEN_PORT}" ;;
  *) usage ;;
esac

NAME="${PROJECT}-api-$2"
PREV="${NAME}-hub-prev"     # 换的过程中旧容器的名字
NEW="${NAME}-hub-new"       # 建好还没换上的新容器
FAILED="${NAME}-hub-failed" # 没过健康检查的新容器，留着看 docker logs，下次失败时换掉
# FBIF_HUB_ENV_DIR 只给本机测试用
HUB_ENV_FILE="${FBIF_HUB_ENV_DIR:-/etc/fbif-hub/env}/${PROJECT}.env"
HEALTH_URL="http://127.0.0.1:${PORT}/health"

die() {
  echo "$1" >&2
  exit "${2:-1}"
}

exists() {
  docker container inspect "$1" >/dev/null 2>&1
}

healthy_within() {
  local deadline=$((SECONDS + $1))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    curl -fsS --max-time 1 -o /dev/null "${HEALTH_URL}" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}

for cmd in docker jq curl; do
  command -v "${cmd}" >/dev/null 2>&1 || die "缺命令 ${cmd}" 2
done
[ -r "${HUB_ENV_FILE}" ] && [ -s "${HUB_ENV_FILE}" ] || die "读不到中台文件 ${HUB_ENV_FILE}，没动容器" 2

# 上次被打断留下的半截：没改名的新容器直接删；旧容器还在 -hub-prev 名下时，
# 原名那个健康就删旧的，不健康就把旧的放回原名
docker rm -f "${NEW}" >/dev/null 2>&1 || true
if exists "${PREV}"; then
  if [ "$(docker container inspect -f '{{.State.Running}}' "${NAME}" 2>/dev/null)" = "true" ] && healthy_within 2; then
    docker rm -f "${PREV}" >/dev/null
  else
    docker rm -f "${NAME}" >/dev/null 2>&1 || true
    docker rename "${PREV}" "${NAME}"
    docker start "${NAME}" >/dev/null
  fi
fi
exists "${NAME}" || die "没有容器 ${NAME}，不知道用哪个镜像重建" 2

info="$(docker container inspect "${NAME}" | jq '.[0]')"

bound="$(jq -r '[.HostConfig.PortBindings // {} | .[][] | "\(.HostIp):\(.HostPort)"] | join(",")' <<<"${info}")"
[ "${bound}" = "127.0.0.1:${PORT}" ] || die "${NAME} 绑的是 ${bound:-（没绑）}，不是 127.0.0.1:${PORT}，没动它" 2
jq -e '[.Config.Env[] | select(contains("\n"))] | length == 0' <<<"${info}" >/dev/null \
  || die "${NAME} 的环境里有带换行的值，写不进 env 文件，没动它" 2

image="$(jq -r '.Image' <<<"${info}")"
network="$(jq -r '.HostConfig.NetworkMode' <<<"${info}")"

args=(--name "${NEW}" --network "${network}")
restart="$(jq -r '.HostConfig.RestartPolicy.Name // ""' <<<"${info}")"
if [ -n "${restart}" ] && [ "${restart}" != "no" ]; then
  args+=(--restart "${restart}")
fi
if [ "$(jq -r '.HostConfig.Init == true' <<<"${info}")" = "true" ]; then
  args+=(--init)
fi
nano_cpus="$(jq -r '.HostConfig.NanoCpus // 0' <<<"${info}")"
if [ "${nano_cpus}" -gt 0 ]; then
  # 老容器可能是机器降配前建的（比如 3 核），docker 不收超过本机核数的 --cpus
  host_cpus="$(docker info --format '{{.NCPU}}')"
  args+=(--cpus "$(awk -v n="${nano_cpus}" -v h="${host_cpus}" 'BEGIN { c = n / 1e9; if (c > h) c = h; printf "%g", c }')")
fi
memory="$(jq -r '.HostConfig.Memory // 0' <<<"${info}")"
if [ "${memory}" -gt 0 ]; then
  args+=(--memory "${memory}")
fi
while IFS= read -r port_spec; do
  args+=(-p "${port_spec}")
done < <(jq -r '.HostConfig.PortBindings // {} | to_entries[] | .key as $c | .value[] | "\(.HostIp):\(.HostPort):\($c)"' <<<"${info}")

# 中台文件只取名字，值不经过这里
hub_names="$({ grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "${HUB_ENV_FILE}" || true; } | tr -d '=' | paste -sd, -)"
kept_env="$(jq -r --arg now "${hub_names}" \
  '(((.Config.Labels // {})["fbif-hub.env-names"] // "" | split(",")) + ($now | split(","))) as $drop
   | .Config.Env[] | select((split("=")[0]) as $k | $drop | index([$k]) | not)' <<<"${info}")"

docker create "${args[@]}" \
  --label "fbif-hub.env-names=${hub_names}" \
  --env-file <(printf '%s\n' "${kept_env}") \
  --env-file "${HUB_ENV_FILE}" \
  "${image}" >/dev/null \
  || { docker rm -f "${NEW}" >/dev/null 2>&1 || true; die "建新容器失败，${NAME} 没动"; }
while IFS= read -r extra_network; do
  docker network connect "${extra_network}" "${NEW}" \
    || { docker rm -f "${NEW}" >/dev/null 2>&1 || true; die "新容器接不上网络 ${extra_network}，${NAME} 没动"; }
done < <(jq -r --arg m "${network}" '.NetworkSettings.Networks | keys[] | select(. != $m)' <<<"${info}")

swap() {
  docker stop -t 10 "${NAME}" >/dev/null || return 1
  docker rename "${NAME}" "${PREV}" || return 1
  docker rename "${NEW}" "${NAME}" || return 1
  docker start "${NAME}" >/dev/null || return 1
  healthy_within 18
}

# 不管换到哪一步失败：新容器停下留作 FAILED，旧容器放回原名再起来
restore() {
  docker rm -f "${FAILED}" >/dev/null 2>&1 || true
  if exists "${PREV}"; then
    if exists "${NAME}"; then
      docker stop -t 5 "${NAME}" >/dev/null 2>&1 || true
      docker rename "${NAME}" "${FAILED}" 2>/dev/null || docker rm -f "${NAME}" >/dev/null 2>&1 || true
    fi
    docker rename "${PREV}" "${NAME}" || return 1
  fi
  docker rm -f "${NEW}" >/dev/null 2>&1 || true
  docker start "${NAME}" >/dev/null || return 1
  healthy_within 12
}

if swap; then
  docker rm -f "${PREV}" >/dev/null 2>&1 || true
  echo "已按中台文件重建 ${NAME}（镜像 ${image:7:12}）"
  exit 0
fi

if restore; then
  die "新的 ${NAME} 没过健康检查，已起回原容器；没起来的那个在 ${FAILED}，看 docker logs ${FAILED}"
fi
die "新的 ${NAME} 没过健康检查，原容器放回去了但也没过健康检查，${HEALTH_URL} 现在不通"
