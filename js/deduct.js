document.addEventListener("DOMContentLoaded", () => {
    if (!requireAuth()) return;

    const form = document.getElementById("deduct-form");
    const msgBox = document.getElementById("message");
    const typeRadios = document.querySelectorAll('input[name="operation_type"]');

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        msgBox.textContent = "";

        const studentId = document.getElementById("student_id").value.trim();
        const pointsInput = document.getElementById("points").value.trim();
        const reason = document.getElementById("reason").value.trim();
        const files = document.getElementById("attachments").files;
        const operationType = document.querySelector('input[name="operation_type"]:checked')?.value;

        if (!studentId || !pointsInput || !reason || !operationType) {
            return showMessage("请填写所有必填字段并选择操作类型", "error");
        }

        const points = parseFloat(pointsInput);
        if (isNaN(points) || points < 0) {
            return showMessage("分数必须为正数或0", "error");
        }

        // 0分警告处理（仅扣分可0分，加分不应为0，限制加分大于0）
        if (operationType === 'bonus' && points === 0) {
            return showMessage("加分分值必须大于0", "error");
        }

        try {
            const token = getToken();
            const adminId = getAdminId();
            const ts = generateTimestamp();
            const attachmentPaths = [];
            const uploadedShas = []; // 用于附件回滚

            // 1. 上传附件（如有）
            if (files.length > 0) {
                showMessage("正在上传附件...", "info");
                for (const file of files) {
                    const fileB64 = await fileToBase64(file);
                    const filePath = `attachments/${ts}_${studentId}/${file.name}`;
                    try {
                        const result = await githubPut(filePath, fileB64, `Upload attachment for penalty ${ts}`, token);
                        attachmentPaths.push(filePath);
                        uploadedShas.push({ path: filePath, sha: result.content.sha });
                    } catch (err) {
                        showMessage(`附件上传失败: ${err.message}，正在回滚...`, "error");
                        for (const item of uploadedShas) {
                            await githubDelete(item.path, item.sha, token).catch(() => {});
                        }
                        throw new Error("附件上传失败，已回滚");
                    }
                }
            }

            // 2. 确定分数变化量（内部使用整数化计算，避免浮点误差）
            const pointsInt = Math.round(points * 100); // 转成百分之一分存储的整数
            let scoreDelta = 0; // 对score.json中整数分数（实际分数×100）的改变量
            let recordType = operationType; // "deduct" 或 "bonus" 或 "warning"(0分扣分)
            if (points === 0 && operationType === 'deduct') {
                recordType = "warning";
            } else {
                scoreDelta = (recordType === 'bonus') ? pointsInt : -pointsInt;
            }

            // 3. 更新分数文件（仅当scoreDelta不为0时）
            let currentScoreRaw = 0; // 存储的原始数值（可能为整数或浮点）
            let scoreSha = null;
            const scorePath = `member/member_info/${studentId}/score.json`;
            if (scoreDelta !== 0) {
                showMessage("正在更新分数...", "info");
                const scoreData = await githubGet(scorePath);
                if (scoreData) {
                    const jsonStr = decodeBase64Content(scoreData.content);
                    currentScoreRaw = JSON.parse(jsonStr).score;
                    scoreSha = scoreData.sha;
                }
                // 转为整数进行运算
                const currentScoreInt = Math.round(currentScoreRaw * 100);
                const newScoreInt = currentScoreInt + scoreDelta;
                const newScore = newScoreInt / 100;   // 保存为小数（如95.5）
                const scoreContent = JSON.stringify({ score: newScore }, null, 2);
                const scoreB64 = utf8ToBase64(scoreContent); // ★ 修复编码
                try {
                    await githubPut(scorePath, scoreB64, `Update score for ${studentId}`, token, scoreSha);
                } catch (err) {
                    showMessage(`分数更新失败: ${err.message}，回滚附件...`, "error");
                    for (const item of uploadedShas) {
                        await githubDelete(item.path, item.sha, token).catch(() => {});
                    }
                    throw new Error("操作失败：分数更新出错，已回滚附件");
                }
            }

            // 4. 创建记录
            showMessage("正在创建记录...", "info");
            const record = {
                id: `${ts}_${studentId}`,
                student_id: studentId,
                points: points,          // 前端显示用的实际分数（正数）
                type: recordType,        // "deduct" / "bonus" / "warning"
                reason: reason,
                attachments: attachmentPaths,
                timestamp: new Date().toISOString(),
                operator: adminId
            };
            const penaltyPath = `penalties/penalty_${ts}_${studentId}.json`;
            const penaltyB64 = utf8ToBase64(JSON.stringify(record, null, 2)); // ★ 修复编码

            try {
                await githubPut(penaltyPath, penaltyB64, `Create penalty for ${studentId}`, token);
            } catch (err) {
                // 回滚分数（如果之前修改过分数）并删除附件
                showMessage(`记录创建失败: ${err.message}，正在回滚...`, "error");
                if (scoreDelta !== 0) {
                    const rollbackScore = currentScoreRaw;
                    const rollbackB64 = utf8ToBase64(JSON.stringify({ score: rollbackScore }));
                    await githubPut(scorePath, rollbackB64, `Rollback score for ${studentId}`, token, scoreSha).catch(() => {});
                }
                for (const item of uploadedShas) {
                    await githubDelete(item.path, item.sha, token).catch(() => {});
                }
                throw new Error("操作失败：记录创建出错，已回滚分数和附件");
            }

            const actionText = recordType === 'bonus' ? '加分' : (recordType === 'warning' ? '警告' : '扣分');
            showMessage(`✓ ${actionText}成功！${studentId} ${recordType === 'warning' ? '已记录警告' : `分数变动 ${recordType === 'bonus' ? '+' : '-'}${points}`}`, "success");
            form.reset();
            // 重置操作类型为扣分
            document.querySelector('input[name="operation_type"][value="deduct"]').checked = true;
        } catch (err) {
            showMessage(`操作失败: ${err.message}`, "error");
        }
    });

    function showMessage(msg, type) {
        msgBox.textContent = msg;
        msgBox.className = `message ${type}`;
    }
});

// ★ 工具函数：安全将字符串转 Base64（修复 bad base-64）
function utf8ToBase64(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    let binary = '';
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary);
}