import { getAccessToken } from './auth';

export async function saveToDrive(filename: string, content: string): Promise<string | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const metadata = {
      name: filename,
      mimeType: 'application/json',
    };
    
    const fileContent = new Blob([content], { type: 'application/json' });
    
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileContent);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form
    });
    
    if (!res.ok) throw new Error('Failed to save to Drive');
    const data = await res.json();
    return data.id; // Return the file ID
  } catch (err) {
    console.error(err);
    alert('Error saving to Drive: ' + err);
    return null;
  }
}

export async function sendChatAlert(spaceId: string, alertText: string): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;

  try {
    const res = await fetch(`https://chat.googleapis.com/v1/spaces/${spaceId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: alertText
      })
    });
    
    if (!res.ok) throw new Error('Failed to send to Chat');
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}
