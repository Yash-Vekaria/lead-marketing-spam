import os
import pandas as pd

# Initialize a set to store distinct links
all_links = set()

# Loop through all directories in current directory
for dirpath, dirnames, filenames in os.walk('.'):
    for filename in filenames:
        if filename.endswith('.xlsx'):
            file_path = os.path.join(dirpath, filename)
            # Read Excel file, skipping second row
            df = pd.read_excel(file_path, skiprows=[1])
            # Extract "Link" column and update set
            all_links.update(df['Link'].dropna().tolist())

# Convert set of links into a DataFrame
result_df = pd.DataFrame({'website': list(all_links)})

# Save to CSV
result_df.to_csv('all_search_result_urls.csv', index=False)
