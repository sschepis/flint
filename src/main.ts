import { App, Editor, MarkdownView, Modal, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { Configuration, OpenAIApi } from 'openai';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

const system = "You are an artificial intelligence natural language template transformation executor.";
const user = "You are tasked with creating a new document from the following markdown AI execution template. You are to read the template and follow its instructions. Instructions for performing the task are provided in the template. Read the question, perform the task, and provide your answer IN MARKDOWN.";
const directiveGenerator = `# Build a Directive to accomplish the given Task

_.Build a Directive to accomplish the task outlined at the end of this document._

## Required Inputs

ONLY generate the directive if the following inputs are provided along with the task. If any of the following inputs are not provided, the task should fail.:

  * \`name\` - The name of the directive
  * \`description\` - A description of the directive

## Optional Inputs

  * \`author\` - The author of the directive
  * \`version\` - The version of the directive
  * \`license\` - The license of the directive
  * \`tags\` - A list of tags to associate with the directive
  * \`parameters\` - A list of parameters to associate with the directive
  * \`output\` - A list of outputs to associate with the directive
  * \`dependencies\` - A list of dependencies to associate with the directive
  * \`examples\` - A list of examples to associate with the directive

## Output

A directive, formatted in Markdown, which when executed by a LLM along with the appropriate inputs, will accomplish the task outlined at the end of this document. The directive must contain the following information:

    * \`name\` - The name of the directive
    * \`description\` - A description of the directive
    * \`author\` - The author of the directive
    * \`version\` - The version of the directive
    * \`tags\` - A list of tags to associate with the directive
    * \`parameters\` - A list of parameters to associate with the directive
    * \`output\` - A list of outputs to associate with the directive
    * \`dependencies\` - A list of dependencies to associate with the directive
    * \`examples\` - A list of examples to associate with the directive

The Directive must contain the following sections:

    * \`Description\` - A description of the directive
    * \`Parameters\` - A list of parameters to associate with the directive
    * \`Output\` - A list of outputs to associate with the directive
    * \`Dependencies\` - A list of dependencies to associate with the directive
    * \`Examples\` - A list of examples to associate with the directive

## Task

`;

interface MDAIUtilsSettings {
    apiKey: string;
    model: string;
    temperature: number;
    directiveGenerator: string;
}

const DEFAULT_SETTINGS: MDAIUtilsSettings = {
    apiKey: '',
    model: 'gpt-4',
    temperature: 0.8,
    directiveGenerator
};

export default class MDAIUtils extends Plugin {
    settings: any;
    configuration: any;
    openai: any;
    modal: any;

    async onload() {
        await this.loadSettings();

        if (!this.settings.apiKey) {
            await this.promptForAPIKey();
        }

        this.configuration = new Configuration({
            apiKey: this.settings.apiKey
        });
        this.openai = new OpenAIApi(this.configuration);

        this.addCommand({
            id: 'mdai-utils-execute-mdai',
            name: 'Execute Directive',
            editorCallback: () => this.executeMDAITemplate(this.app)
        });

        this.addCommand({
            id: 'mdai-utils-execute-mdai-input',
            name: 'Execute Directive with input...',
            callback: () => this.executeMDAIWithInput(),
        });

        this.addCommand({
            id: 'mdai-utils-generate-directive',
            name: 'Generate Directive...',
            callback: () => this.generateDirective(),
        });

        this.addCommand({
            id: 'complete-in-place',
            name: 'Complete in place',
            callback: () => this.onCompleteInPlace(),
            hotkeys: [{
                modifiers: ['Mod'],
                key: 'Enter',
            }],
        });

        this.addSettingTab(new MDAIUtilsSettingTab(this.app, this));
    }

    async executeMDAITemplate(app: App) {
        const editor = app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        const markdown = editor?.getValue();
        if (!markdown) {
            console.error('No markdown content found');
            return;
        }
        try {
            const response = await this.createChatCompletion(markdown);
            const cid = await this.generateCID(response);
            app.vault.create(`${cid}.md`, response);
        } catch (error) {
            console.error('Error during API call or file creation:', error);
        }
    }
    async executeMDAIWithInput(): Promise<void> {
        const activeLeaf = this.app.workspace.activeLeaf;
        if (!activeLeaf) {
            return;
        }
        const editor = (activeLeaf.view as any).editor;
        if (!editor) {
            return;
        }
        const currentContent = editor.getValue();
        const userInput = await this.promptForUserInput();
        if (userInput === null) {
            return;
        }
        const combinedContent = `${currentContent}\n${userInput}`;

        try {
            const response = await this.createChatCompletion(combinedContent);
            const cid = await this.generateCID(response);
            this.app.vault.create(`${cid}.md`, response);
        } catch (error) {
            console.error('Error during API call or file creation:', error);
        }
    }
    async promptForUserInput(): Promise<string | null> {
        return new Promise((resolve) => {
            const modal = new Modal(this.app);
            modal.titleEl.innerHTML = 'Enter your input';
            const inputEl = modal.contentEl.createEl('input', { type: 'text' });
            inputEl.placeholder = 'Enter text input...';
            const submitButton = modal.contentEl.createEl('button', { text: 'Submit' });
            submitButton.addEventListener('click', () => {
                resolve(inputEl.value);
                modal.close();
            });
            modal.onClose = () => {
                resolve(null);
            };

            modal.open();
        });
    }
    async promptForAPIKey() {
        const modal = new Modal(this.app);
        (modal as any).setContent(`
            <div>
                <h3>Please enter your OpenAI API key</h3>
                <input type="text" id="api-key-input" name="api-key">
            </div>
        `);
        const saveButton = modal.contentEl.createEl('button', { text: 'Save' });
        saveButton.addEventListener('click', async () => {
            const apiKey = (document.getElementById('api-key-input') as any).value;
            this.settings.apiKey = apiKey;
            await this.saveSettings();
            modal.close();
        });
    }

    async handleClick(this: any) {
        const self = this as any;
        const apiKey = (document.getElementById('api-key-input') as any).value;
        self.settings.apiKey = apiKey;
        await this.saveSettings();
        this.modal.close();
    }


    async generateDirective(): Promise<void> {
        const activeLeaf = this.app.workspace.activeLeaf;
        if (!activeLeaf) {
            return;
        }
        const editor = (activeLeaf.view as any).editor;
        if (!editor) {
            return;
        }

        let contentToProcess = editor.getSelection();
        if (!contentToProcess) {
            contentToProcess = editor.getValue();
        }

        const combinedContent = `${this.settings.directiveGenerator}\n${contentToProcess}`;

        try {
            const response = await this.createChatCompletion(combinedContent);
            const cid = await this.generateCID(response);
            this.app.vault.create(`${cid}.md`, response);
        } catch (error) {
            console.error('Error during API call or file creation:', error);
        }
    }

    async createChatCompletion(prompt: string) {
        try {
            const chatMessages = [
                { role: "system", content: system },
                { role: "user", content: user },
                { role: "user", content: prompt }
            ];
            const completion = await this.openai.createChatCompletion({
                model: this.settings.model,
                messages: chatMessages,
                temperature: this.settings.temperature,
            } as any);
            return (completion.data.choices[0] as any).content;
        } catch (error) {
            console.error('Error during API call:', error);
            throw error;
        }
    }

    async generateCID(content: string) {
        // Convert the content to a Uint8Array
        const uint8Content = new TextEncoder().encode(content);
        // Create a hash of the content
        const hash = await sha256.digest(uint8Content);
        // Create a CID using the hash
        const cid = CID.create(1, sha256.code, hash);
        return cid.toString();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async onCompleteInPlace(): Promise<void> {
        const activeLeaf = this.app.workspace.activeLeaf;
        if (!activeLeaf) {
            return;
        }
        const editor = (activeLeaf.view as any).editor;
        if (!editor) {
            return;
        }
        const selectedText = editor.getSelection();
        if (!selectedText) {
            return;
        }
        // Replace this function with your actual API call
        const chatGPTResponse = await this.createChatCompletion(selectedText);
        editor.replaceSelection(chatGPTResponse);
    }

}


class MDAIUtilsSettingTab extends PluginSettingTab {
    plugin: MDAIUtils;
    constructor(app: App, plugin: MDAIUtils) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl }: any = this;

        containerEl.empty();

        containerEl.createEl('h2', { text: 'Settings for MDAIUtils plugin.' });

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Enter your OpenAI API key.')
            .addText(text => text
                .setPlaceholder('Enter your API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Model')
            .setDesc('Enter the OpenAI model to use.')
            .addText(text => text
                .setPlaceholder('Enter the model name')
                .setValue(this.plugin.settings.model)
                .onChange(async (value) => {
                    this.plugin.settings.model = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Temperature')
            .setDesc('Enter the desired temperature for the model.')
            .addSlider(slider => slider
                .setLimits(0, 1, 0.1)
                .setValue(this.plugin.settings.temperature)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.temperature = value;
                    await this.plugin.saveSettings();
                }));
    }
}