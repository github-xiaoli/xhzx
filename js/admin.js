document.addEventListener("DOMContentLoaded", () => {
    const scoreTbody = document.getElementById("score-table-body");
    const queryInput = document.getElementById("query-student-id");
    const queryBtn = document.getElementById("query-btn");
    const queryResult = document.getElementById("query-result");

    loadScoreList();

    queryBtn.addEventListener("click", () => queryRecords());

    // 预览模态框关闭按钮
    const modal = document.getElementById("preview-modal");
    const modalClose = document.getElementById("modal-close");
    const modalContent = document.getElementById("modal-content");
    modalClose.addEventListener("click", () => {
        modal.style.display = "none";
        modalContent.innerHTML = "";
    });
    window.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.style.display = "none";
            modalContent.innerHTML = "";
        }
    });

    // 文件类型判断（简单判断扩展名）
    function isImage(fileName) {
        return /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(fileName);
    }
    function isPdfOrText(fileName) {
        return /\.(pdf|txt|md|log)$/i.test(fileName);
    }

    // 附件预览函数
    window.previewAttachment = (url, fileName) => {
        const modal = document.getElementById("preview-modal");
        const content = document.getElementById("modal-content");
        content.innerHTML = ""; // 清空
        if (isImage(fileName)) {
            const img = document.createElement("img");
            img.src = url;
            img.style.maxWidth = "100%";
            img.style.maxHeight = "80vh";
            content.appendChild(img);
        } else if (isPdfOrText(fileName)) {
            const iframe = document.createElement("iframe");
            iframe.src = url;
            iframe.style.width = "100%";
            iframe.style.height = "80vh";
            content.appendChild(iframe);
        } else {
            content.innerHTML = `
                <p>无法直接预览此文件类型。</p>
                <a href="${url}" target="_blank">在新窗口打开</a>
            `;
        }
        modal.style.display = "block";
    };
});

async function loadScoreList() {
    const tbody = document.getElementById("score-table-body");
    tbody.innerHTML = "<tr><td colspan='2'>加载中...</td></tr>";
    try {
        const dirs = await listDirectories("member/member_info");
        if (dirs.length === 0) {
            tbody.innerHTML = "<tr><td colspan='2'>暂无成员数据</td></tr>";
            return;
        }
        const scores = [];
        for (const d of dirs) {
            let score = 0;
            try {
                const data = await githubGet(`member/member_info/${d}/score.json`);
                if (data) {
                    const content = decodeBase64(data.content);
                    score = JSON.parse(content).score;
                }
            } catch (_) { /* 文件不存在则为 0 */ }
            scores.push({ id: d, score });
        }
        scores.sort((a, b) => a.id.localeCompare(b.id));
        tbody.innerHTML = scores.map(s => `<tr><td>${s.id}</td><td>${s.score}</td></tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan='2' class="error">加载失败: ${err.message}</td></tr>`;
    }
}

async function queryRecords() {
    const sid = document.getElementById("query-student-id").value.trim();
    const resultDiv = document.getElementById("query-result");
    if (!sid) return resultDiv.innerHTML = "<p>请输入学号</p>";
    resultDiv.innerHTML = "<p>查询中...</p>";
    try {
        const records = await fetchPenaltyRecords(sid);
        if (records.length === 0) {
            return resultDiv.innerHTML = "<p>未找到该学号的扣分记录。</p>";
        }
        let html = `<table>
            <thead><tr><th>时间</th><th>分数</th><th>理由</th><th>附件</th><th>操作</th></tr></thead><tbody>`;
        for (const rec of records) {
            const attachHtml = rec.attachments.map(a => {
                const fileName = a.split('/').pop();
                const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${a}`;
                return `<a href="javascript:void(0)" onclick="previewAttachment('${rawUrl}','${fileName}')">${fileName}</a>`;
            }).join(', ');
            html += `<tr>
                <td>${new Date(rec.timestamp).toLocaleString("zh-CN")}</td>
                <td>${rec.points}</td>
                <td>${rec.reason}</td>
                <td>${attachHtml || '无'}</td>
                <td><button class="delete-btn" data-file="penalties/penalty_${rec.id}.json" data-student="${rec.student_id}" data-points="${rec.points}">🗑️ 删除</button></td>
            </tr>`;
        }
        html += "</tbody></table>";
        resultDiv.innerHTML = html;

        // 绑定删除事件
        document.querySelectorAll(".delete-btn").forEach(btn => {
            btn.addEventListener("click", async function() {
                const filePath = this.dataset.file;
                const studentId = this.dataset.student;
                const points = parseInt(this.dataset.points, 10);
                if (!confirm(`确定要删除该扣分记录吗？将返还 ${points} 分给 ${studentId}。`)) return;
                try {
                    const token = await getGitHubToken();
                    // 1. 获取文件信息（需要 sha）
                    const fileData = await githubGet(filePath);
                    if (!fileData) throw new Error("记录文件不存在");
                    // 2. 删除记录文件
                    await githubDelete(filePath, fileData.sha, token);

                    // 3. 恢复分数
                    const scorePath = `member/member_info/${studentId}/score.json`;
                    const scoreData = await githubGet(scorePath);
                    let currentScore = 0;
                    let scoreSha = null;
                    if (scoreData) {
                        currentScore = JSON.parse(decodeBase64(scoreData.content)).score || 0;
                        scoreSha = scoreData.sha;
                    }
                    const newScore = currentScore + points;
                    const scoreB64 = encodeBase64(JSON.stringify({ score: newScore }, null, 2));
                    await githubPut(scorePath, scoreB64, `Recover score after deleting penalty`, token, scoreSha);
                    alert("删除成功，分数已恢复！");
                    // 刷新查询结果
                    queryRecords();
                    loadScoreList(); // 同时更新成员列表
                } catch (err) {
                    alert("删除失败: " + err.message);
                }
            });
        });
    } catch (err) {
        resultDiv.innerHTML = `<p class="error">查询失败: ${err.message}</p>`;
    }
}

async function fetchPenaltyRecords(sid) {
    const files = await listFiles("penalties");
    const matches = files.filter(f => f.includes(`_${sid}.json`));
    const records = [];
    for (const f of matches) {
        const data = await githubGet(`penalties/${f}`);
        if (data) {
            const json = JSON.parse(decodeBase64(data.content));
            records.push(json);
        }
    }
    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return records;
}