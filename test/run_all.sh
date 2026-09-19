#!/usr/bin/env bash
# 一次跑完全部检查。用法: bash run_all.sh
#
# 顺序有讲究：先生成桩副本，再语法检查，再静态检查，最后才跑联网测试。
#
# 关于退出码：这里一律先 `x=$(cmd); rc=$?` 再判断，不写成 `cmd | grep ... || FAILED`。
# 那种写法里 `||` 挂的是管道最后一环（grep/tail），它们基本永远成功，
# 于是真正失败的命令会被吞掉、脚本照样打印"全部通过"。踩过这个坑。
cd "$(dirname "$0")" || exit 1

TMP="."
FILTER='MODULE_TYPELESS|Reparsing as ES module|To eliminate this warning|trace-warnings'
FAILED=()

step() { echo; echo "########## $1 ##########"; }
strip() { grep -vE "$FILTER"; }

step "0. 生成桩副本"
if ! out=$(node prep.mjs 2>&1); then echo "$out"; echo "prep 失败，中止"; exit 1; fi
echo "$out" | strip

step "1. 脚本语法检查（把 .ux 的 script 段当 ES module 解析）"
node lint.mjs > /dev/null 2>&1   # lint 会导出 _chk_*.mjs
for f in "$TMP/_chk_index.mjs" "$TMP/_chk_city.mjs" "$TMP/_chk_forecast.mjs"; do
  out=$(node --check "$f" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then
    echo "  OK   $(basename "$f") 语法合法"
  else
    echo "  FAIL $(basename "$f")"; echo "$out" | strip | head -5
    FAILED+=("语法 $(basename "$f")")
  fi
done

step "2. 静态检查 / 布局算术"
lint_out=$(node lint.mjs 2>&1); lint_rc=$?
echo "$lint_out" | strip | tail -22
[ $lint_rc -ne 0 ] && FAILED+=("lint")

for t in t1_wmo t2_weather t3_fallback t4_cache t6_page t7_manifest t8_forecast t9_regress t10_switch; do
  step "$t"
  out=$(node "$t.mjs" 2>&1); rc=$?
  shown=$(echo "$out" | strip)
  echo "$shown" | tail -8
  if [ $rc -ne 0 ]; then
    FAILED+=("$t"); echo "  ^^ 退出码 $rc"
  elif echo "$shown" | grep -qE "FAIL|✗|未通过"; then
    FAILED+=("$t"); echo "  ^^ 输出里有失败项"
  fi
done

step "3. 出图（图标 + 整页）"
for r in render_icons render_page; do
  out=$(node "$r.mjs" 2>&1); rc=$?
  echo "$out" | strip | head -3
  [ $rc -ne 0 ] && { FAILED+=("$r"); echo "  ^^ $r 退出码 $rc"; }
done

echo
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "===== 全部通过 ====="
else
  echo "===== 未通过: ${FAILED[*]} ====="
  exit 1
fi
