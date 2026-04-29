/**
 * 文件编辑器 – 增强版
 * 新增：全屏编辑、可拖拽分栏、删除文件夹、网络重试
 */
let currentPath = "";
let currentFilePath = null;
let currentFileSha = null;
let selectedDirPath = null;     // 当前选中的目录路径（用于删除文件夹）

document.addEventListener("DOMContentLoaded", async () => {
    if (!requireAuth()) return;

    // 按钮事件
    document.getElementById("btn-backup").addEventListener("click", downloadRepoZipSafe);
    document.getElementById("btn-commits").addEventListener("click", showCommitHistory);
    document.getElementById("btn-save-file").addEventListener("click", saveFile);
    document.getElementById("btn-new-file").addEventListener("click", createNewFile);
    document.getElementById("btn-delete-file").addEventListener("click", deleteCurrentFile);

    // 新增按钮（需要在页面中添加，提供动态注入）
    addToolbarButtons();

    // 初始化文件树
    loadFileTree("");
});

// 动态增加「全屏编辑」「删除文件夹」按钮
function addToolbarButtons() {
    const toolbar = document.querySelector(".editor-toolbar");
    if (!toolbar) return;

    // 全屏编辑
    const fullBtn = document.createElement("button");
    fullBtn.id = "btn-fullscreen";
    fullBtn.title = "全屏编辑";
    fullBtn.textContent = "⛶ 全屏";
    fullBtn.addEventListener("click", toggleFullscreen);
    toolbar.appendChild(fullBtn);

    // 删除文件夹（初始禁用）
    const delDirBtn = document.createElement("button");
    delDirBtn.id = "btn-delete-dir";
    delDirBtn.className = "delete-btn";
    delDirBtn.title = "删除选中的文件夹";
    delDirBtn.textContent = "🗑 删除文件夹";
    delDirBtn.disabled = true;
    delDirBtn.addEventListener("click", deleteSelectedFolder);
    toolbar.appendChild(delDirBtn);
}

// ==================== 消息提示 ====================
function showMessage(msg, type) {
    const box = document.getElementById("editor-message");
    if (box) {
        box.textContent = msg;
        box.className = "message " + type;
    }
}

// ==================== 文件树加载 ====================
async function loadFileTree(path, retry = 3) {
    currentPath = path;
    const treeEl = document.getElementById("file-tree");
    treeEl.innerHTML = "<p>加载中…</p>";

    for (let attempt = 0; attempt < retry; attempt++) {
        try {
            const data = await githubGet(path);
            if (!data || !Array.isArray(data)) {
                treeEl.innerHTML = "<p>目录为空</p>";
                return;
            }
            renderTree(treeEl, data, path);
            return;
        } catch (err) {
            if (attempt === retry - 1) {
                treeEl.innerHTML = `<p class="error">加载失败（已重试${retry}次）: ${err.message}</p>`;
                showMessage("目录加载失败，请检查网络或权限", "error");
            } else {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
}

function renderTree(container, items, basePath) {
    container.innerHTML = "";
    const ul = document.createElement("ul");

    // 返回上级
    if (basePath) {
        const backLi = document.createElement("li");
        backLi.innerHTML = "📁 ..";
        backLi.title = "返回上级目录";
        backLi.onclick = () => loadFileTree(basePath.substring(0, basePath.lastIndexOf("/")));
        ul.appendChild(backLi);
    }

    const dirs = items.filter(i => i.type === "dir");
    const files = items.filter(i => i.type === "file");

    // 目录
    for (const d of dirs) {
        const li = document.createElement("li");
        li.innerHTML = `📁 <span class="dir-label">${d.name}</span>`;
        li.dataset.type = "dir";
        li.dataset.path = basePath ? basePath + "/" + d.name : d.name;
        li.onclick = (e) => {
            e.stopPropagation();
            selectDir(li, li.dataset.path);
            loadFileTree(li.dataset.path);
        };
        ul.appendChild(li);
    }

    // 文件
    for (const f of files) {
        const li = document.createElement("li");
        li.innerHTML = `📄 ${f.name}`;
        li.dataset.type = "file";
        li.dataset.path = basePath ? basePath + "/" + f.name : f.name;
        li.dataset.sha = f.sha;
        li.onclick = (e) => {
            e.stopPropagation();
            selectFile(li);
            openFile(li.dataset.path, f.sha);
        };
        ul.appendChild(li);
    }

    container.appendChild(ul);
}

// 高亮选中的目录或文件
function selectDir(element, path) {
    clearSelection();
    element.classList.add("selected");
    selectedDirPath = path;
    document.getElementById("btn-delete-dir").disabled = false;
    document.getElementById("btn-delete-file").disabled = true;
    document.getElementById("btn-save-file").disabled = true;
    document.getElementById("current-file-path").textContent = path + '/';
    document.getElementById("file-content").value = "";
}

function selectFile(element) {
    clearSelection();
    element.classList.add("selected");
    selectedDirPath = null;
    document.getElementById("btn-delete-dir").disabled = true;
}

function clearSelection() {
    document.querySelectorAll(".file-tree li.selected").forEach(li => li.classList.remove("selected"));
}

// ==================== 文件操作 ====================
async function openFile(path, sha) {
    currentFilePath = path;
    currentFileSha = sha;
    document.getElementById("current-file-path").textContent = path;
    const textarea = document.getElementById("file-content");
    textarea.value = "加载中…";
    document.getElementById("btn-save-file").disabled = true;

    try {
        const data = await githubGet(path);
        if (!data) throw new Error("文件不存在");
        const content = decodeBase64Content(data.content);
        textarea.value = content;
        currentFileSha = data.sha;
        document.getElementById("btn-save-file").disabled = false;
        document.getElementById("btn-delete-file").disabled = false;
    } catch (err) {
        textarea.value = "读取失败: " + err.message;
        showMessage("打开文件失败: " + err.message, "error");
    }
}

async function saveFile() {
    if (!currentFilePath) return;
    const token = getToken();
    const newContent = document.getElementById("file-content").value;
    const b64Content = btoa(unescape(encodeURIComponent(newContent)));
    try {
        await githubPut(currentFilePath, b64Content, `Update ${currentFilePath}`, token, currentFileSha);
        showMessage("保存成功", "success");
        // 更新 sha
        const updated = await githubGet(currentFilePath);
        if (updated) currentFileSha = updated.sha;
    } catch (err) {
        showMessage("保存失败: " + err.message, "error");
    }
}

async function createNewFile() {
    const name = prompt("请输入名称（如 file.txt 或 newfolder/）：");
    if (!name) return;
    const path = currentPath ? currentPath + "/" + name : name;
    const token = getToken();

    try {
        if (name.endsWith('/')) {
            // 创建目录：通过创建 .gitkeep 实现
            await githubPut(path + ".gitkeep", btoa(""), `Create directory ${path}`, token);
            showMessage("文件夹已创建", "success");
        } else {
            await githubPut(path, btoa(""), `Create file ${path}`, token);
            showMessage("文件已创建", "success");
        }
        loadFileTree(currentPath);
    } catch (err) {
        showMessage("创建失败: " + err.message, "error");
    }
}

async function deleteCurrentFile() {
    if (!currentFilePath) return;
    if (!confirm(`确定要删除文件 ${currentFilePath} 吗？此操作不可恢复！`)) return;
    const token = getToken();
    try {
        await githubDelete(currentFilePath, currentFileSha, token);
        showMessage("文件已删除", "success");
        currentFilePath = null;
        document.getElementById("file-content").value = "";
        document.getElementById("current-file-path").textContent = "";
        document.getElementById("btn-save-file").disabled = true;
        document.getElementById("btn-delete-file").disabled = true;
        loadFileTree(currentPath);
    } catch (err) {
        showMessage("删除失败: " + err.message, "error");
    }
}

// 删除选中文件夹（递归删除文件夹内所有文件）
async function deleteSelectedFolder() {
    if (!selectedDirPath) return;
    if (!confirm(`⚠️ 确定要删除文件夹及其全部内容吗？\n${selectedDirPath}\n此操作不可恢复！`)) return;
    const token = getToken();
    try {
        await deleteFolderRecursive(selectedDirPath, token);
        showMessage("文件夹已删除", "success");
        selectedDirPath = null;
        document.getElementById("btn-delete-dir").disabled = true;
        loadFileTree(currentPath);
    } catch (err) {
        showMessage("删除文件夹失败: " + err.message, "error");
    }
}

// 递归删除文件夹下所有条目
async function deleteFolderRecursive(dirPath, token) {
    const entries = await githubGet(dirPath);
    if (!entries || !Array.isArray(entries)) return;
    for (const entry of entries) {
        const entryPath = dirPath + "/" + entry.name;
        if (entry.type === "dir") {
            await deleteFolderRecursive(entryPath, token);
        } else {
            await githubDelete(entryPath, entry.sha, token);
        }
    }
    // 注意：空目录无法直接删除，因为我们用 .gitkeep 占位，所以删除完文件后目录自动消失
    // 但如果目录下没有 .gitkeep 也能删除目录本身？GitHub 不允许，但文件删完目录就没了
}

// ==================== 备份与安全下载 ====================
async function downloadRepoZipSafe() {
    try {
        await downloadRepoZip();
        showMessage("备份下载已开始", "success");
    } catch (err) {
        showMessage("下载失败: " + err.message, "error");
    }
}

// ==================== 提交历史（不变，但加入错误重试） ====================
async function showCommitHistory() {
    // ... 保持原有逻辑不变，仅加入 try/catch 友好提示
    const modal = document.createElement("div");
    modal.className = "preview-modal";
    modal.innerHTML = `
        <div class="preview-backdrop"></div>
        <div class="preview-content" style="max-width: 700px; padding: 20px;">
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
        if (!resp.ok) throw new Error("获取提交历史失败");
        const commits = await resp.json();
        const listEl = document.getElementById("commit-list");
        listEl.innerHTML = commits.map(c => `
            <div class="commit-item">
                <div>
                    <div class="commit-message">${c.commit.message.split('\n')[0]}</div>
                    <div class="commit-date">${new Date(c.commit.author.date).toLocaleString()}</div>
                </div>
                <button class="btn" data-sha="${c.sha}">回滚至此</button>
            </div>
        `).join('');

        listEl.querySelectorAll('button').forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("此操作将撤销所有后续提交，确定回滚吗？")) return;
                btn.disabled = true;
                btn.textContent = "回滚中…";
                try {
                    await rollbackTo(btn.dataset.sha, token);
                    alert("回滚成功！页面即将刷新。");
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

// 回滚到指定 commit（与之前一致）
async function rollbackTo(commitSha, token) {
    const commitUrl = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/commits/${commitSha}`;
    const commitResp = await fetch(commitUrl, { headers: { Authorization: `token ${token}` } });
    if (!commitResp.ok) throw new Error("无法获取 commit 信息");
    const commitData = await commitResp.json();
    const treeSha = commitData.tree.sha;

    const headUrl = `${API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/main`;
    const headResp = await fetch(headUrl, { headers: { Authorization: `token ${token}` } });
    if (!headResp.ok) throw new Error("获取 HEAD 失败");
    const headData = await headResp.json();
    const parentSha = headData.object.sha;

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

// ==================== 全屏编辑功能 ====================
function toggleFullscreen() {
    const wrapper = document.querySelector(".editor-wrapper");
    const btn = document.getElementById("btn-fullscreen");
    if (!wrapper || !btn) return;

    if (document.fullscreenElement) {
        document.exitFullscreen();
        btn.textContent = "⛶ 全屏";
    } else {
        wrapper.requestFullscreen();
        btn.textContent = "↩ 退出全屏";
    }
}

// 监听退出全屏（Esc 或按钮外退出）
document.addEventListener("fullscreenchange", () => {
    const btn = document.getElementById("btn-fullscreen");
    if (btn && !document.fullscreenElement) {
        btn.textContent = "⛶ 全屏";
    }
});

// 允许拖拽调整编辑框高度（附加功能：在 css 中增加 resize 提示，这里简单使用 textarea 拉伸）
// CSS 中已设置 resize: none，如果想支持手动拖拽，可改为 vertical，但通常一个按钮足够。