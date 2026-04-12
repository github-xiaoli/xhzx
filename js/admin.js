// 管理页面逻辑 - 自动展示成员分数及全部扣分记录

document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素
    const scoreListBody = document.getElementById('score-list-body');
    const refreshScoresBtn = document.getElementById('refresh-scores-btn');
    const penaltiesContainer = document.getElementById('penalties-list-container');
    const refreshPenaltiesBtn = document.getElementById('refresh-penalties-btn');

    // 页面加载时自动加载两项数据
    loadMemberScores();
    loadAllPenalties();

    // 刷新按钮事件
    refreshScoresBtn.addEventListener('click', loadMemberScores);
    refreshPenaltiesBtn.addEventListener('click', loadAllPenalties);

    // ----- 加载成员分数列表 -----
    async function loadMemberScores() {
        scoreListBody.innerHTML = '<tr><td colspan="2" class="text-center">加载中...</td></tr>';
        try {
            const dirList = await listDirectory('member/member_info');
            const folders = dirList.filter(item => item.type === 'dir');
            const studentIds = folders.map(item => item.name).sort();

            if (studentIds.length === 0) {
                scoreListBody.innerHTML = '<tr><td colspan="2" class="text-center">暂无成员数据</td></tr>';
                return;
            }

            const scorePromises = studentIds.map(async (id) => {
                const scorePath = `member/member_info/${id}/score.json`;
                try {
                    const { content } = await readFile(scorePath);
                    const data = JSON.parse(content);
                    return { id, score: data.score };
                } catch (error) {
                    if (error.message.includes('404') || error.message.includes('Not Found')) {
                        const initialContent = JSON.stringify({ score: 0 }, null, 2);
                        await writeFile(
                            scorePath,
                            initialContent,
                            `初始化分数: 学号${id}`,
                            true
                        );
                        return { id, score: 0 };
                    } else {
                        console.error(`获取 ${id} 分数失败:`, error);
                        return { id, score: '错误' };
                    }
                }
            });

            const scores = await Promise.all(scorePromises);
            let html = '';
            scores.forEach(({ id, score }) => {
                html += `<tr><td>${id}</td><td>${score}</td></tr>`;
            });
            scoreListBody.innerHTML = html;
        } catch (error) {
            console.error('加载成员列表失败:', error);
            scoreListBody.innerHTML = `<tr><td colspan="2" class="text-center">加载失败: ${error.message}</td></tr>`;
        }
    }

    // ----- 加载全部扣分记录（自动扫描）-----
    async function loadAllPenalties() {
        penaltiesContainer.innerHTML = '<div class="message info">正在加载扣分记录...</div>';
        try {
            // 获取 penalties 目录下所有文件
            const files = await listDirectory('penalties');
            const penaltyFiles = files.filter(f => f.name.startsWith('penalty_') && f.name.endsWith('.json'));

            if (penaltyFiles.length === 0) {
                penaltiesContainer.innerHTML = '<div class="message info">暂无扣分记录</div>';
                return;
            }

            // 按文件名倒序排列（时间戳大的在前）
            penaltyFiles.sort((a, b) => b.name.localeCompare(a.name));

            // 并行获取所有文件内容
            const records = [];
            for (const file of penaltyFiles) {
                try {
                    const { content } = await readFile(file.path);
                    const record = JSON.parse(content);
                    records.push(record);
                } catch (e) {
                    console.error(`读取 ${file.name} 失败:`, e);
                }
            }

            // 渲染记录卡片
            if (records.length === 0) {
                penaltiesContainer.innerHTML = '<div class="message info">暂无有效扣分记录</div>';
                return;
            }

            let html = '';
            records.forEach(record => {
                const timeStr = new Date(record.timestamp).toLocaleString('zh-CN');
                const attachmentsHtml = record.attachments && record.attachments.length > 0
                    ? `<ul class="attachment-list">${record.attachments.map(path => {
                        const fileName = path.split('/').pop();
                        return `<li><a href="https://github.com/${OWNER}/${REPO}/blob/${BRANCH}/${path}" target="_blank">${fileName}</a></li>`;
                    }).join('')}</ul>`
                    : '无附件';

                html += `<div class="card">
                    <div class="card-header">
                        <span><strong>学号：</strong>${record.student_id}</span>
                        <span><strong>扣分：</strong>${record.points}</span>
                    </div>
                    <div><strong>时间：</strong>${timeStr}</div>
                    <div style="margin-top: 8px;"><strong>理由：</strong>${record.reason}</div>
                    <div style="margin-top: 8px;"><strong>附件：</strong>${attachmentsHtml}</div>
                </div>`;
            });

            penaltiesContainer.innerHTML = html;
        } catch (error) {
            console.error('加载扣分记录失败:', error);
            penaltiesContainer.innerHTML = `<div class="message error">加载失败: ${error.message}</div>`;
        }
    }
});