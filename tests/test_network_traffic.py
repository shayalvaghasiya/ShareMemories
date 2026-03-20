import asyncio
import aiohttp
import time
import argparse
import os

'''
python tests/test_network_traffic.py --url "https://largest-partly-delays-advertise.trycloudflare.com" --event 1 --image "my_selfie.jpg" --users 20
'''


async def simulate_user(session, url, event_id, image_path, user_id):
    search_url = f"{url.rstrip('/')}/search"
    
    try:
        # Prepare the multipart form data
        data = aiohttp.FormData()
        data.add_field('event_id', str(event_id))
        
        # Open the image file (each request needs its own file handle read)
        with open(image_path, 'rb') as f:
            data.add_field('file', f, filename=f'user_{user_id}_selfie.jpg', content_type='image/jpeg')
            
            start_time = time.time()
            # Send the POST request
            async with session.post(search_url, data=data) as response:
                elapsed = time.time() - start_time
                status = response.status
                
                if status == 200:
                    res_data = await response.json()
                    matches = len(res_data.get("matches", []))
                    print(f"[User {user_id}] ✅ Success: {matches} matches found in {elapsed:.2f}s")
                else:
                    error_text = await response.text()
                    print(f"[User {user_id}] ❌ Failed with status {status} in {elapsed:.2f}s: {error_text}")
                    
    except Exception as e:
        print(f"[User {user_id}] ⚠️ Connection Error: {str(e)}")

async def main():
    parser = argparse.ArgumentParser(description="Test Cloudflare tunnel traffic for ShareMemories")
    parser.add_argument("--url", required=True, help="Cloudflare URL (e.g., https://your-tunnel.trycloudflare.com)")
    parser.add_argument("--event", required=True, help="Event ID to search within (e.g., 1)")
    parser.add_argument("--image", required=True, help="Path to a test image file containing a single face")
    parser.add_argument("--users", type=int, default=20, help="Number of concurrent users (default: 20)")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.image):
        print(f"Error: Test image file not found at {args.image}")
        return
        
    print(f"Starting load test with {args.users} concurrent users targeting {args.url}...")
    print("-" * 60)
    
    start_time = time.time()
    
    # Create an async HTTP session
    async with aiohttp.ClientSession() as session:
        tasks = []
        for i in range(args.users):
            task = asyncio.create_task(simulate_user(session, args.url, args.event, args.image, i + 1))
            tasks.append(task)
            
        await asyncio.gather(*tasks)
        
    total_time = time.time() - start_time
    print(f"\n🚀 Load test completed! Total time: {total_time:.2f}s")

if __name__ == "__main__":
    asyncio.run(main())