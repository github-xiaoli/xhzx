document.addEventListener("DOMContentLoaded", () => {
    if (!requireAuth()) return;

    const form = document.getElementById("school-form");
    const msgBox = document.getElementById("message");
    const queryBtn = document.getElementById("school-query-btn");
    const queryResult = document.getElementById("school-query-result");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        msgBox.textContent = "";

        const studentId = document.getElementById("school-student-id").value.trim();
        const name = document.getElementById("school-name").value.trim();
        const pointsInput = document.getElementById("school-points").value.trim();
        const reason = document.getElementById("school-reason").value.trim();
        const files = document.getElementById("school-attachments").files;

        if (!studentId || !name || !pointsInput || !reason) {
            return showMessage("请填写所有必填字段", "error");
        }
        const points = parseFloat(pointsInput);
        if (isNaN(points) || points < 0) {
            return showMessage("分值必须为正数或0", "error");
        }

        try {
            const token = getToken();
            const adminId = getAdminId();
            const ts = generateTimestamp();
            const recordId = `${ts}_${studentId}`;
            const attachmentPaths = [];
            const uploadedShas = [];

            // 上传附件到 attachments/school/{recordId}/
            if (files.length > 0) {
                showMessage("正在上传附件...", "info");
                for (const file of files) {
                    const fileB64 = await fileToBase64(file);
                    const filePath = `attachments/school/${recordId}/${file.name}`;
                    try {
                        const result = await githubPut(filePath, fileB64, `Upload school attachment for ${recordId}`, token);
                        attachmentPaths.push(filePath);
                        uploadedShas.push({ path: filePath, sha: result.content.sha });
                    } catch (err) {
                        showMessage(`附件上传失败: ${err.message}，回滚...`, "error");
                        for (const item of uploadedShas) {
                            await githubDelete(item.path, item.sha, token).catch(() => {});
                        }
                        throw new Error("附件上传失败，已回滚");
                    }
                }
            }

            showMessage("正在保存违纪记录...", "info");
            const record = {
                id: recordId,
                student_id: studentId,
                name: name,
                points: points,
                reason: reason,
                attachments: attachmentPaths,
                timestamp: new Date().toISOString(),
                operator: adminId
            };
            const recordPath = `school_penalties/school_penalty_${recordId}.json`;
            const recordB64 = utf8ToBase64(JSON.stringify(record, null, 2));
            await githubPut(recordPath, recordB64, `Create school penalty for ${studentId}`, token);

            showMessage(`✓ 违纪记录已保存！学号: ${studentId}, 分值: ${points}`, "success");
            form.reset();
        } catch (err) {
            showMessage(`操作失败: ${err.message}`, "error");
        }
    });

    // 查询
    queryBtn.addEventListener("click", async () => {
        const sid = document.getElementById("school-query-id").value.trim();
        if (!sid) {
            queryResult.innerHTML = "<p>请输入学号</p>";
            return;
        }
        queryResult.innerHTML = "<p>查询中…</p>";
        try {
            const records = await querySchoolRecords(sid);
            if (records.length === 0) {
                queryResult.innerHTML = "<p>未找到该学号的违纪记录。</p>";
                return;
            }
            let html = `<table><thead><tr><th>时间</th><th>姓名</th><th>分值</th><th>事由</th><th>附件</th><th>操作人</th><th>操作</th></tr></thead><tbody>`;
            for (const rec of records) {
                html += `<tr id="school-row-${rec.id}">
                    <td>${new Date(rec.timestamp).toLocaleString()}</td>
                    <td>${rec.name}</td>
                    <td>${rec.points}</td>
                    <td>${rec.reason}</td>
                    <td>${renderAttachments(rec.attachments)}</td>
                    <td>${rec.operator || '未知'}</td>
                    <td><button class="delete-btn school-delete-btn" data-id="${rec.id}">🗑 删除</button></td>
                </tr>`;
            }
            html += "</tbody></table>";
            queryResult.innerHTML = html;

            document.querySelectorAll(".school-delete-btn").forEach(btn => {
                btn.addEventListener("click", onDeleteSchoolRecord);
            });
        } catch (err) {
            queryResult.innerHTML = `<p class="error">查询失败: ${err.message}</p>`;
        }
    });

    async function onDeleteSchoolRecord(e) {
        const btn = e.currentTarget;
        const id = btn.dataset.id;
        if (!confirm(`确定要删除该违纪记录 (${id}) 吗？附件也将被删除。`)) return;
        btn.disabled = true;
        btn.textContent = "删除中…";
        try {
            const token = getToken();
            // 删除记录文件
            const recordPath = `school_penalties/school_penalty_${id}.json`;
            const fileData = await githubGet(recordPath);
            if (!fileData) throw new Error("记录文件不存在");
            await githubDelete(recordPath, fileData.sha, token);

            // 删除附件目录
            const attachDir = `attachments/school/${id}`;
            const attachFiles = await listFiles(attachDir);
            for (const f of attachFiles) {
                const fData = await githubGet(`${attachDir}/${f}`);
                if (fData) await githubDelete(`${attachDir}/${f}`, fData.sha, token).catch(() => {});
            }

            document.getElementById(`school-row-${id}`).remove();
            alert("删除成功");
        } catch (err) {
            alert("删除失败: " + err.message);
        } finally {
            btn.disabled = false;
            btn.textContent = "🗑 删除";
        }
    }

    async function querySchoolRecords(sid) {
        const files = await listFiles("school_penalties");
        const matches = files.filter(f => f.includes(`_${sid}.json`));
        const records = [];
        for (const f of matches) {
            const data = await githubGet(`school_penalties/${f}`);
            if (data) {
                const jsonStr = decodeBase64Content(data.content);
                records.push(JSON.parse(jsonStr));
            }
        }
        records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return records;
    }

    // 复用附件渲染（可从 admin.js 复制或公用，这里内联一份）
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

    // 预览监听
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

    function showMessage(msg, type) {
        msgBox.textContent = msg;
        msgBox.className = `message ${type}`;
    }
});