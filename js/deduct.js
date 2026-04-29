document.addEventListener("DOMContentLoaded", () => {
    // 强制登录
    if (!requireAuth()) return;

    const form = document.getElementById("deduct-form");
    const msgBox = document.getElementById("message");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        msgBox.textContent = "";

        const studentId = document.getElementById("student_id").value.trim();
        const pointsInput = document.getElementById("points").value.trim();
        const reason = document.getElementById("reason").value.trim();
        const files = document.getElementById("attachments").files;

        if (!studentId || !pointsInput || !reason) {
            return showMessage("请填写所有必填字段", "error");
        }
        const points = parseInt(pointsInput, 10);
        if (isNaN(points) || points <= 0) {
            return showMessage("分数必须为正整数", "error");
        }

        try {
            const token = getToken();
            const adminId = getAdminId();
            const ts = generateTimestamp();
            const attachmentPaths = [];
            const uploadedShas = [];

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

            showMessage("正在更新分数...", "info");
            const scorePath = `member/member_info/${studentId}/score.json`;
            let currentScore = 0;
            let scoreSha = null;
            const scoreData = await githubGet(scorePath);
            if (scoreData) {
                const jsonStr = decodeBase64Content(scoreData.content);
                currentScore = JSON.parse(jsonStr).score || 0;
                scoreSha = scoreData.sha;
            }
            const newScore = currentScore - points;
            const scoreContent = JSON.stringify({ score: newScore }, null, 2);
            const scoreB64 = btoa(unescape(encodeURIComponent(scoreContent)));

            try {
                await githubPut(scorePath, scoreB64, `Update score for ${studentId}`, token, scoreSha);
            } catch (err) {
                showMessage(`分数更新失败: ${err.message}，回滚附件...`, "error");
                for (const item of uploadedShas) {
                    await githubDelete(item.path, item.sha, token).catch(() => {});
                }
                throw new Error("扣分失败：分数更新出错，已回滚附件");
            }

            showMessage("正在创建扣分记录...", "info");
            const record = {
                id: `${ts}_${studentId}`,
                student_id: studentId,
                points: points,
                reason: reason,
                attachments: attachmentPaths,
                timestamp: new Date().toISOString(),
                operator: adminId        // ← 使用当前管理员 ID
            };
            const penaltyPath = `penalties/penalty_${ts}_${studentId}.json`;
            const penaltyB64 = btoa(unescape(encodeURIComponent(JSON.stringify(record, null, 2))));

            try {
                await githubPut(penaltyPath, penaltyB64, `Create penalty for ${studentId}`, token);
            } catch (err) {
                showMessage(`扣分记录创建失败: ${err.message}，正在回滚...`, "error");
                const rollbackB64 = btoa(unescape(encodeURIComponent(JSON.stringify({ score: currentScore }))));
                await githubPut(scorePath, rollbackB64, `Rollback score for ${studentId}`, token, scoreSha).catch(() => {});
                for (const item of uploadedShas) {
                    await githubDelete(item.path, item.sha, token).catch(() => {});
                }
                throw new Error("扣分失败：记录创建出错，已回滚分数和附件");
            }

            showMessage(`✓ 扣分成功！${studentId} 被扣 ${points} 分，当前分数 ${newScore}`, "success");
            form.reset();
        } catch (err) {
            showMessage(`操作失败: ${err.message}`, "error");
        }
    });

    function showMessage(msg, type) {
        msgBox.textContent = msg;
        msgBox.className = `message ${type}`;
    }
});