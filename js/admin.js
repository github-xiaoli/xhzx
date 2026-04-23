document.addEventListener("DOMContentLoaded", () => {
    const scoreTbody = document.getElementById("score-table-body");
    const queryInput = document.getElementById("query-student-id");
    const queryBtn = document.getElementById("query-btn");
    const queryResult = document.getElementById("query-result");

    loadScoreList();

    queryBtn.addEventListener("click", async () => {
        const sid = queryInput.value.trim();
        if (!sid) return (queryResult.innerHTML = "<p>请输入学号</p>");
        queryResult.innerHTML = "<p>查询中...</p>";
        try {
            const records = await queryPenaltyRecords(sid);
            if (records.length === 0) {
                queryResult.innerHTML = "<p>未找到该学号的扣分记录。</p>";
                return;
            }
            let html = "<table><thead><tr><th>时间</th><th>分数</th><th>理由</th><th>附件</th></tr></thead><tbody>";
            for (const rec of records) {
                const attachHtml = rec.attachments.map(a =>
                    `<a href="https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${a}" target="_blank">${a.split('/').pop()}</a>`
                ).join(', ');
                html += `<tr>
                    <td>${new Date(rec.timestamp).toLocaleString()}</td>
                    <td>${rec.points}</td>
                    <td>${rec.reason}</td>
                    <td>${attachHtml || '无'}</td>
                </tr>`;
            }
            html += "</tbody></table>";
            queryResult.innerHTML = html;
        } catch (err) {
            queryResult.innerHTML = `<p class="error">查询失败: ${err.message}</p>`;
        }
    });
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
                if (data) score = JSON.parse(atob(data.content)).score;
            } catch (_) { /* 文件不存在则为 0 */ }
            scores.push({ id: d, score });
        }
        scores.sort((a, b) => a.id.localeCompare(b.id));
        tbody.innerHTML = scores.map(s => `<tr><td>${s.id}</td><td>${s.score}</td></tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan='2' class="error">加载失败: ${err.message}</td></tr>`;
    }
}

async function queryPenaltyRecords(sid) {
    const files = await listFiles("penalties");
    const matches = files.filter(f => f.includes(`_${sid}.json`));
    const records = [];
    for (const f of matches) {
        const data = await githubGet(`penalties/${f}`);
        if (data) records.push(JSON.parse(atob(data.content)));
    }
    records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return records;
}