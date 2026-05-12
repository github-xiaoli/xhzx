document.addEventListener("DOMContentLoaded", () => {
    if (!requireAuth()) return;

    loadScoreList();
    document.getElementById("query-btn").addEventListener("click", queryHandler);
});

// --- 成员分数列表 ---
async function loadScoreList() {
    const tbody = document.getElementById("score-table-body");
    tbody.innerHTML = "<tr><td colspan='2'>加载中…</td></tr>";
    try {
        const dirs = await listDirectories("member/member_info");
        if (dirs.length === 0) {
            tbody.innerHTML = "<tr><td colspan='2'>暂无成员数据</td></tr>";
            return;
        }
        const scores = [];
        for (const d of dirs) {
            let score = 0;
            const data = await githubGet(`member/member_info/${d}/score.json`);
            if (data) {
                const jsonStr = decodeBase64Content(data.content);
                score = JSON.parse(jsonStr).score;
            }
            scores.push({ id: d, score });
        }
        scores.sort((a, b) => a.id.localeCompare(b.id));
        tbody.innerHTML = scores.map(s => `<tr><td>${s.id}</td><td>${s.score}</td></tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan='2' class="error">加载失败: ${err.message}</td></tr>`;
    }
}

// --- 扣分/加分记录查询 ---
async function queryHandler() {
    const sid = document.getElementById("query-student-id").value.trim();
    const resultDiv = document.getElementById("query-result");
    if (!sid) {
        resultDiv.innerHTML = "<p>请输入学号</p>";
        return;
    }
    resultDiv.innerHTML = "<p>查询中…</p>";
    try {
        const records = await queryPenaltyRecords(sid);
        if (records.length === 0) {
            resultDiv.innerHTML = "<p>未找到该学号的记录。</p>";
            return;
        }
        let html = `<table id="penalty-table">
            <thead><tr><th>时间</th><th>类型</th><th>分数</th><th>理由</th><th>附件</th><th>操作人</th><th>管理</th></tr></thead><tbody>`;
        for (const rec of records) {
            const attachCell = renderAttachments(rec.attachments);
            const typeText = rec.type === 'bonus' ? '加分' : (rec.type === 'warning' ? '警告' : '扣分');
            html += `<tr id="row-${rec.id}">
                <td>${new Date(rec.timestamp).toLocaleString()}</td>
                <td>${typeText}</td>
                <td>${rec.points}</td>
                <td>${rec.reason}</td>
                <td>${attachCell}</td>
                <td>${rec.operator || '未知'}</td>
                <td><button class="delete-btn" data-id="${rec.id}" data-sid="${rec.student_id}" data-points="${rec.points}" data-type="${rec.type || 'deduct'}">🗑 删除</button></td>
            </tr>`;
        }
        html += "</tbody></table>";
        resultDiv.innerHTML = html;

        document.querySelectorAll(".delete-btn").forEach(btn => {
            btn.addEventListener("click", onDeleteRecord);
        });
    } catch (err) {
        resultDiv.innerHTML = `<p class="error">查询失败: ${err.message}</p>`;
    }
}

async function queryPenaltyRecords(sid) {
    const files = await listFiles("penalties");
    const matches = files.filter(f => f.includes(`_${sid}.json`));
    const records = [];
    for (const f of matches) {
        const data = await githubGet(`penalties/${f}`);
        if (data) {
            const jsonStr = decodeBase64Content(data.content);
            records.push(JSON.parse(jsonStr));
        }
    }
    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return records;
}

// 附件渲染函数（同之前）
function renderAttachments(attachments) {
    if (!attachments || attachments.length === 0) return "无";
    let html = "<div class='attach-list'>";
    attachments.forEach(path => {
        const parts = path.split('/');
        const filename = parts.pop();
        const safeFilename = encodeURIComponent(filename);
        const safePath = parts.join('/') + '/' + safeFilename;
        const siteUrl = '/' + safePath;
        const ext = filename.split('.').pop().toLowerCase();
        if (['png','jpg','jpeg','gif','svg','webp','bmp'].includes(ext)) {
            html += `<div class="attach-item">
                <a href="${siteUrl}" target="_blank"><img src="${siteUrl}" class="attach-thumb" loading="lazy" alt="${filename}"></a>
                <span class="attach-name">${filename}</span>
                <a href="${siteUrl}" target="_blank" class="preview-link">[原图]</a>
            </div>`;
        } else if (ext === 'pdf') {
            html += `<div class="attach-item">
                <span class="attach-name">${filename}</span>
                <a href="${siteUrl}" target="_blank" class="preview-link">[打开PDF]</a>
                <button class="preview-btn" data-url="${siteUrl}" data-type="pdf">预览</button>
            </div>`;
        } else {
            html += `<div class="attach-item">
                <span class="attach-name">${filename}</span>
                <a href="${siteUrl}" target="_blank" class="preview-link">[下载]</a>
            </div>`;
        }
    });
    html += "</div>";
    return html;
}

// 预览事件（保持不变）
document.addEventListener("click", function(e) {
    if (e.target.classList.contains("preview-btn")) {
        const url = e.target.dataset.url;
        const type = e.target.dataset.type;
        showPreview(url, type);
    }
});

function showPreview(url, type) {
    const modal = document.createElement("div");
    modal.className = "preview-modal";
    modal.innerHTML = `
        <div class="preview-backdrop"></div>
        <div class="preview-content">
            <span class="preview-close">&times;</span>
            ${type === 'pdf' 
                ? `<iframe src="${url}" width="100%" height="600px"></iframe>` 
                : `<img src="${url}" style="max-width:100%; max-height:80vh;">`}
        </div>`;
    document.body.appendChild(modal);
    modal.querySelector(".preview-close").onclick = () => modal.remove();
    modal.querySelector(".preview-backdrop").onclick = () => modal.remove();
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") modal.remove();
    }, { once: true });
}

// --- 删除记录（根据type调整分数恢复）---
async function onDeleteRecord(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.id;
    const sid = btn.dataset.sid;
    const points = parseFloat(btn.dataset.points);   // 前端显示值
    const type = btn.dataset.type || "deduct";       // 老记录无type视为扣分

    if (!confirm(`确定要删除该${type === 'bonus' ? '加分' : type === 'warning' ? '警告' : '扣分'}记录吗？\n学号: ${sid}\n分数: ${points} 分\n${type === 'bonus' ? '删除后将扣除对应分数' : type === 'deduct' ? '删除后将恢复分数' : '仅删除记录'}`)) {
        return;
    }

    btn.disabled = true;
    btn.textContent = "删除中…";
    try {
        const token = getToken();
        const penaltyPath = `penalties/penalty_${id}.json`;
        const fileData = await githubGet(penaltyPath);
        if (!fileData) throw new Error("记录文件不存在");
        await githubDelete(penaltyPath, fileData.sha, token);

        // 分数恢复/扣除（仅非警告记录需要处理）
        if (type !== 'warning') {
            const scorePath = `member/member_info/${sid}/score.json`;
            const scoreData = await githubGet(scorePath);
            let currentScoreRaw = 0;
            let scoreSha = null;
            if (scoreData) {
                const jsonStr = decodeBase64Content(scoreData.content);
                currentScoreRaw = JSON.parse(jsonStr).score;
                scoreSha = scoreData.sha;
            }
            const pointsInt = Math.round(points * 100);
            const currentScoreInt = Math.round(currentScoreRaw * 100);
            let newScoreInt;
            if (type === 'bonus') {
                // 删除加分：减去加分值
                newScoreInt = currentScoreInt - pointsInt;
            } else {
                // 删除扣分：加回分值
                newScoreInt = currentScoreInt + pointsInt;
            }
            const newScore = newScoreInt / 100;
            const scoreContent = JSON.stringify({ score: newScore }, null, 2);
            const scoreB64 = utf8ToBase64(scoreContent);
            await githubPut(scorePath, scoreB64, `Adjust score for ${sid} after delete ${type} ${id}`, token, scoreSha);
        }

        // 删除附件
        try {
            const attachDir = `attachments/${id}`;
            const attachFiles = await listFiles(attachDir);
            for (const f of attachFiles) {
                const fData = await githubGet(`${attachDir}/${f}`);
                if (fData) await githubDelete(`${attachDir}/${f}`, fData.sha, token).catch(() => {});
            }
        } catch (_) { }

        document.getElementById(`row-${id}`).remove();
        alert("删除成功。");
        loadScoreList();
    } catch (err) {
        alert("删除失败: " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "🗑 删除";
    }
}