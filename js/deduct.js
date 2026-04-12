// 扣分页面逻辑

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('deduct-form');
    const messageDiv = document.getElementById('message');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // 获取表单数据
        const studentId = document.getElementById('student_id').value.trim();
        const points = parseInt(document.getElementById('points').value, 10);
        const reason = document.getElementById('reason').value.trim();
        const attachmentsInput = document.getElementById('attachments');
        const files = attachmentsInput.files;

        // 简单验证
        if (!studentId) {
            showMessage('请输入学号', 'error');
            return;
        }
        if (!points || points <= 0) {
            showMessage('扣分分数必须为正整数', 'error');
            return;
        }
        if (!reason) {
            showMessage('请输入扣分理由', 'error');
            return;
        }

        // 生成时间戳（毫秒级）
        const now = new Date();
        const timestampStr = now.getTime().toString();
        const isoString = now.toISOString();

        // 禁用表单，显示加载状态
        setFormLoading(true);
        showMessage('正在处理扣分，请稍候...', 'info');

        try {
            // 1. 上传附件（如果有）
            const attachmentPaths = [];
            if (files.length > 0) {
                const folderName = `${timestampStr}_${studentId}`;
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const fileBase64 = await fileToBase64(file);
                    const cleanBase64 = fileBase64.split(',')[1]; // 移除 data:xxx;base64, 前缀
                    const filePath = `attachments/${folderName}/${file.name}`;
                    
                    await uploadFile(
                        filePath,
                        cleanBase64,
                        `上传附件: ${file.name} (扣分记录 ${timestampStr})`,
                        true
                    );
                    attachmentPaths.push(filePath);
                }
            }

            // 2. 获取当前成员的 score.json，如果不存在则创建
            const scorePath = `member/member_info/${studentId}/score.json`;
            let currentScore = 0;
            let scoreSha = null;
            try {
                const { content, sha } = await readFile(scorePath);
                currentScore = JSON.parse(content).score || 0;
                scoreSha = sha;
            } catch (error) {
                // 文件不存在，视为 0 分，稍后创建
                currentScore = 0;
            }

            // 计算新分数（扣分是累加扣分值，最终分数为负数）
            const newScore = currentScore - points;

            // 3. 创建扣分记录 JSON
            const penaltyRecord = {
                id: `${timestampStr}_${studentId}`,
                student_id: studentId,
                points: points,
                reason: reason,
                attachments: attachmentPaths,
                timestamp: isoString,
                operator: 'web' // 可从卡密获取，这里简写
            };

            const penaltyFileName = `penalty_${timestampStr}_${studentId}.json`;
            const penaltyPath = `penalties/${penaltyFileName}`;
            const penaltyContent = JSON.stringify(penaltyRecord, null, 2);

            // 4. 写入扣分记录文件
            await writeFile(
                penaltyPath,
                penaltyContent,
                `扣分记录: 学号${studentId} 扣${points}分`,
                true
            );

            // 5. 更新 score.json
            const newScoreContent = JSON.stringify({ score: newScore }, null, 2);
            await writeFile(
                scorePath,
                newScoreContent,
                `更新分数: 学号${studentId} 当前分数 ${newScore}`,
                true
            );

            // 成功
            showMessage(`扣分成功！${studentId} 被扣 ${points} 分，当前总分 ${newScore}`, 'success');
            
            // 清空表单（可选保留学号以便连续扣分，这里清空全部）
            form.reset();
        } catch (error) {
            console.error('扣分操作失败:', error);
            showMessage(`操作失败: ${error.message}`, 'error');
        } finally {
            setFormLoading(false);
        }
    });

    // 辅助函数：显示消息
    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = `message ${type}`;
    }

    // 辅助函数：设置表单加载状态
    function setFormLoading(isLoading) {
        const submitBtn = form.querySelector('button[type="submit"]');
        const inputs = form.querySelectorAll('input, textarea, button');
        if (isLoading) {
            submitBtn.disabled = true;
            submitBtn.textContent = '处理中...';
            form.classList.add('loading');
        } else {
            submitBtn.disabled = false;
            submitBtn.textContent = '提交扣分';
            form.classList.remove('loading');
        }
    }

    // 辅助函数：文件转 Base64
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
});