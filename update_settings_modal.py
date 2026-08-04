import re

filepath = r'd:\Projects\v2ray-test\src\components\SettingsModal.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Add SettingCard definition
setting_card_def = '''
const SettingCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={g-card/50 border border-border/50 rounded-xl p-4 }>
    {children}
  </div>
);
'''
content = content.replace('export const SettingsModal: React.FC = () => {', setting_card_def + '\nexport const SettingsModal: React.FC = () => {')

# Replace div wrappers with SettingCard
# 1. Theme Settings
content = content.replace('<div className="bg-card/50 border border-border/50 rounded-xl p-4 space-y-3">', '<SettingCard className="space-y-3">')
# 2. Language Settings
# 3. Acrylic Switch
# (All these use the same string above)

# 4. Real Delay URLs List
content = content.replace('<div className="bg-card/50 border border-border/50 rounded p-4 space-y-3">', '<SettingCard className="space-y-3">')

# 5. Speed Test URLs
content = content.replace('<div className="bg-card/50 border border-border/50 rounded p-4 space-y-4">', '<SettingCard className="space-y-4">')

# Replace the closing divs for these specific blocks. Since it's hard to target the exact closing div safely with simple regex, I will do a precision replace via python.
# Theme
content = content.replace('''                    )}
                  </Button>
                </div>
              </div>''', '''                    )}
                  </Button>
                </div>
              </SettingCard>''')

# Language
content = content.replace('''                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>''', '''                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </SettingCard>''')

# Acrylic
content = content.replace('''                    onCheckedChange={handleAcrylicToggle}
                  />
                </div>
              </div>''', '''                    onCheckedChange={handleAcrylicToggle}
                  />
                </div>
              </SettingCard>''')

# Real Delay URLs List
content = content.replace('''                  <Button type="submit" size="sm" className="gap-1">
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('add')}</span>
                  </Button>
                </form>
              </div>''', '''                  <Button type="submit" size="sm" className="gap-1">
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('add')}</span>
                  </Button>
                </form>
              </SettingCard>''')

# Speed Test URLs
content = content.replace('''                      className="bg-card border border-border text-foreground rounded px-2 py-1 outline-none focus:border-primary transition-colors w-full text-xs ltr:text-left rtl:text-right font-mono"
                    />
                  </div>
                </div>
              </div>''', '''                      className="bg-card border border-border text-foreground rounded px-2 py-1 outline-none focus:border-primary transition-colors w-full text-xs ltr:text-left rtl:text-right font-mono"
                    />
                  </div>
                </div>
              </SettingCard>''')


with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated SettingsModal.tsx")
