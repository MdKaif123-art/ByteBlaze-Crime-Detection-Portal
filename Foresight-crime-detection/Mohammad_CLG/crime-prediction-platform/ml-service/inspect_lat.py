import pandas as pd
df=pd.read_csv(r'c:\Users\gowth\Desktop\Mohammad_CLG\Final\Final\TamilNadu_FIR_Dataset_1Lakh_Claude.csv')
zeros = (df['Latitude'].fillna(0) == 0).sum()
with open("result.txt", "w") as f:
    f.write(str(zeros))
