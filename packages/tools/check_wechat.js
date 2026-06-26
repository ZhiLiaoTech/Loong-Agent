import { execSync } from 'node:child_process';
try {
    const result = execSync('tasklist', { encoding: 'utf8' });
    const lines = result.split('\n').filter(l => l.toLowerCase().includes('wechat'));
    if (lines.length > 0) {
        console.log('✅ 微信正在运行:');
        lines.forEach(l => console.log(l));
    } else {
        console.log('❌ 微信未运行');
    }
} catch (e) {
    console.log('Error:', e.message);
}
