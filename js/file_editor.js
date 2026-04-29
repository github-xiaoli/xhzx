let currentPath = "";          // 当前查看的仓库目录
let currentFilePath = null;    // 当前打开的文件路径
let currentFileSha = null;

document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;

    document.getElementById("btn-backup").addEventListener("click", async () => {
        try {
            await downloadRepoZip();
            showMessage("备份下载已开始", "success");
        } catch (err) {
            showMessage("下载失败: " + err.message, "error");
        }
    });

    document.getElementById("btn-commits").addEventListener("click", showCommitHistory);
    document.getElementById("btn-save-file").addEventListener("click", saveFile);
    document.getElementById("btn-new-file").addEventListener("click", createNewFile);
    document.getElementById("btn-delete-file").addEventListener("click", deleteCurrentFile);

    loadFileTree("");
});

function showMessage(msg, type) {
    const box = document.getElementById("editor-message");
    box.textContent = msg;
    box.className = "message " + type;
}

async function loadFileTree(path) {
    currentPath = path;
    const treeEl = document.getElementById("file-tree");
    treeEl.innerHTML = "<p>加载中…</p>";
    try {
        const data = await githubGet(path);
        if (!data || !Array.isArray(data)) {
            treeEl.innerHTML = "<p>空目录</p>";
            return;
        }
        renderTree(treeEl, data, path);
    } catch (err) {
        treeEl.innerHTML = `<p class="error">加载失败: ${err.message}</p>`;
    }
}

function renderTree(container, items, basePath) {
    container.innerHTML = "";
    const ul = document.createElement("ul");
    // 返回上级（如果不在根目录）
    if (basePath) {
        const backLi = document.createElement("li");
        backLi.innerHTML = "📁 ..";
        backLi.onclick = () => loadFileTree(basePath.split('/').slice(0, -1).join('/'));
        ul.appendChild(backLi);
    }
    // 目录在前，文件在后
    const dirs = items.filter(i => i.type === "dir");
    const files = items.filter(i => i.type === "file");
    for (const d of dirs) {
        const li = document.createElement("li");
        li.innerHTML = `📁 <span class="dir-label">${d.name}</span>`;
        li.onclick = () => loadFileTree(basePath ? basePath + "/" + d.name : d.name);
        ul.appendChild(li);
    }
    for (const f of files) {
        const li = document.createElement("li");
        li.innerHTML = `📄 ${f.name}`;
        li.onclick = () => openFile(basePath ? basePath + "/" + f.name : f.name, f.sha);
        ul.appendChild(li);
    }
    container.appendChild(ul);
}

async function openFile(path, sha) {
    currentFilePath = path;
    currentFileSha = sha;
    document.getElementById("current-file-path").textContent = path;
    document.getElementById("file-content").value = "加载中…";
    document.getElementById("btn-save-file").disabled = true;
    try {
        const data = await githubGet(path);
        if (!data) throw new Error("文件不存在");
        const content = decodeBase64Content(data.content);
        document.getElementById("file-content").value = content;
        currentFileSha = data.sha;
        document.getElementById("btn-save-file").disabled = false;
    } catch (err) {
        document.getElementById("file-content").value = "读取失败: " + err.message;
    }
}

async function saveFile() {
    if (!currentFilePath) return;
    const token = getToken();
    const newContent = document.getElementById("file-content").value;
    const b64Content = btoa(unescape(encodeURIComponent(newContent)));
    try {
        await githubPut(currentFilePath, b64Content, `Update ${currentFilePath}`, token, currentFileSha);
        const updated = await githubGet(currentFilePath);
        if (updated) currentFileSha = updated.sha;
        showMessage("文件保存成功", "success");
    } catch (err) {
        showMessage("保存失败: " + err.message, "error");
    }
}

async function createNewFile() {
    const name = prompt("请输入新文件名（如 data.txt 或 folder/）：");
    if (!name) return;
    const path = currentPath ? currentPath + "/" + name : name;
    if (name.endsWith('/')) {
        // 创建目录：上传一个 .gitkeep
        const token = getToken();
        try {
            await githubPut(path + ".gitkeep", btoa(""), `Create directory ${path}`, token);
            showMessage("目录已创建", "success");
            loadFileTree(currentPath);
        } catch (err) {
            showMessage("创建失败: " + err.message, "error");
        }
    } else {
        // 创建空文件
        const token = getToken();
        try {
            await githubPut(path, btoa(""), `Create file ${path}`, token);
            showMessage("文件已创建", "success");
            loadFileTree(currentPath);
        } catch (err) {
            showMessage("创建失败: " + err.message, "error");
        }
    }
}

async function deleteCurrentFile() {
    if (!currentFilePath) return;
    if (!confirm(`确定要删除 ${currentFilePath} 吗？`)) return;
    const token = getToken();
    try {
        await githubDelete(currentFilePath, currentFileSha, token);
        showMessage("文件已删除", "success");
        currentFilePath = null;
        document.getElementById("file-content").value = "";
        document.getElementById("current-file-path").textContent = "";
        document.getElementById("btn-save-file").disabled = true;
        loadFileTree(currentPath);
    } catch (err) {
        showMessage("删除失败: " + err.message, "error");
    }
}

// --- 提交历史与回滚 ---
async function showCommitHistory() {
    const modal = document.createElement("div");
    modal.className = "preview-modal";
    modal.innerHTML = `
        <div class="preview-backdrop"></div>
        <div class="preview-content" style="max-width: 700px;">
            <span class="preview-close">&times;</span>
            <h2>提交历史</h2>
            <div id="commit-list" class="commit-list">加载中...</div>
        </div>`;
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector(".preview-close").onclick = closeModal;
    modal.querySelector(".preview-backdrop").onclick = closeModal;

    try {
        const token = getToken();
        const resp = await fetch(`${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits?per_page=30`, {
            headers: { Authorization: `token ${token}` }
        });
        if (!resp.ok) throw new Error("获取提交失败");
        const commits = await resp.json();
        const listEl = document.getElementById("commit-list");
        listEl.innerHTML = commits.map(c => `
            <div class="commit-item">
                <div>
                    <div class="commit-message">${c.commit.message.split('\n')[0]}</div>
                    <div class="commit-date">${new Date(c.commit.author.date).toLocaleString()}</div>
                </div>
                <button class="btn btn-sm" data-sha="${c.sha}">回滚至此</button>
            </div>
        `).join('');

        listEl.querySelectorAll('button').forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("警告：此操作将撤销所有后续提交，回到该时间点的状态，确定吗？")) return;
                const sha = btn.dataset.sha;
                btn.disabled = true;
                btn.textContent = "回滚中…";
                try {
                    await rollbackTo(sha, token);
                    alert("回滚成功！页面将刷新。");
                    window.location.reload();
                } catch (err) {
                    alert("回滚失败: " + err.message);
                    btn.disabled = false;
                    btn.textContent = "回滚至此";
                }
            });
        });
    } catch (err) {
        document.getElementById("commit-list").innerHTML = `<p class="error">错误: ${err.message}</p>`;
    }
}

async function rollbackTo(commitSha, token) {
    // 1. 获取该 commit 的 tree sha
    const commitUrl = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${commitSha}`;
    const commitResp = await fetch(commitUrl, { headers: { Authorization: `token ${token}` } });
    if (!commitResp.ok) throw new Error("无法获取 commit 信息");
    const commitData = await commitResp.json();
    const treeSha = commitData.tree.sha;

    // 2. 获取当前 HEAD 的父 commit（最新 commit）作为新 commit 的 parent
    const headUrl = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/main`;
    const headResp = await fetch(headUrl, { headers: { Authorization: `token ${token}` } });
    if (!headResp.ok) throw new Error("无法获取 HEAD");
    const headData = await headResp.json();
    const parentSha = headData.object.sha;

    // 3. 创建新 commit，使用旧 tree，parent 为当前 HEAD
    const createCommitUrl = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits`;
    const newCommitResp = await fetch(createCommitUrl, {
        method: "POST",
        headers: {
            "Authorization": `token ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            message: `Revert to ${commitSha.substring(0, 7)} (via web editor)`,
            tree: treeSha,
            parents: [parentSha]
        })
    });
    if (!newCommitResp.ok) throw new Error("创建回滚 commit 失败");
    const newCommit = await newCommitResp.json();

    // 4. 更新 main 分支引用
    const updateRefUrl = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/main`;
    const updateResp = await fetch(updateRefUrl, {
        method: "PATCH",
        headers: {
            "Authorization": `token ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ sha: newCommit.sha, force: false })
    });
    if (!updateResp.ok) throw new Error("更新分支引用失败");
}